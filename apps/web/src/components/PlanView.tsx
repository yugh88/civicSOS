import { Badge, Card, SampleNote, SectionHeading, type Tone } from './ui';
import { URGENCY_LABEL, URGENCY_TONE, formatDate, formatRelative } from '@/lib/format';
import type { EscalationStep, EvidenceRequirement, PlanStep, ResolutionPlan, SubmissionChannel } from '@/lib/types';

/**
 * The "What happens next?" view — the product's core differentiator.
 *
 * Everything shown here is produced by the deterministic rules engine, not by a
 * language model: who handles the problem, what evidence is needed, what the
 * citizen should do now, what happens after submission, when to follow up, and
 * how to escalate. The model only ever contributes the plain-English summary.
 */

const STEP_MARK: Record<PlanStep['status'], { symbol: string; classes: string; label: string }> = {
  DONE: { symbol: '✓', classes: 'bg-good text-white', label: 'Done' },
  CURRENT: { symbol: '→', classes: 'bg-accent text-white', label: 'Do this now' },
  UPCOMING: { symbol: '', classes: 'bg-surface-sunken text-ink-faint ring-1 ring-inset ring-line-strong', label: 'Later' },
};

const OWNER_LABEL: Record<PlanStep['owner'], string> = {
  YOU: 'You',
  AUTHORITY: 'The authority',
  CIVICSOS: 'CivicSOS',
};

function Timeline({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="relative space-y-1">
      {steps.map((step, index) => {
        const mark = STEP_MARK[step.status];
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0">
            {/* The connector is decorative; the ordered list carries the meaning. */}
            {!isLast ? (
              <span aria-hidden="true" className="absolute left-4 top-9 h-[calc(100%-1.5rem)] w-px bg-line" />
            ) : null}
            <span
              aria-hidden="true"
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${mark.classes}`}
            >
              {mark.symbol || index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h4
                  className={`text-sm font-semibold ${step.status === 'UPCOMING' ? 'text-ink-muted' : 'text-ink'}`}
                >
                  {step.title}
                </h4>
                {step.status === 'CURRENT' ? <Badge tone="accent">Do this now</Badge> : null}
                {step.status === 'DONE' ? <span className="sr-only">Completed</span> : null}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
              <p className="mt-1.5 text-xs text-ink-faint">
                {OWNER_LABEL[step.owner]}
                {step.dueAt ? ` · ${formatRelative(step.dueAt)} (${formatDate(step.dueAt)})` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EvidenceChecklist({ items }: { items: EvidenceRequirement[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="flex gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
              item.satisfied ? 'bg-good-soft text-good ring-1 ring-inset ring-good-line' : 'bg-surface-sunken text-ink-faint ring-1 ring-inset ring-line-strong'
            }`}
          >
            {item.satisfied ? '✓' : ''}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {item.label}
              {!item.required ? <span className="ml-2 text-xs font-normal text-ink-faint">optional</span> : null}
              <span className="sr-only">{item.satisfied ? ' — done' : ' — still needed'}</span>
            </p>
            <p className="text-sm text-ink-muted">{item.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const CHANNEL_ICON: Record<SubmissionChannel['kind'], string> = {
  WEB_PORTAL: '🌐',
  PHONE: '📞',
  MOBILE_APP: '📱',
  EMAIL: '✉️',
  IN_PERSON: '🏢',
};

function Channels({ channels }: { channels: SubmissionChannel[] }) {
  return (
    <ul className="space-y-3">
      {channels.map((channel, index) => (
        <li key={`${channel.label}-${index}`} className="rounded-xl border border-line bg-surface-soft p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex items-start gap-2 text-sm font-medium text-ink">
              <span aria-hidden="true">{CHANNEL_ICON[channel.kind]}</span>
              <span>{channel.label}</span>
            </p>
            {/* Honesty marker: a template entry is never presented as verified. */}
            {channel.isSample ? (
              <Badge tone="warn">Generic guidance</Badge>
            ) : (
              <Badge tone="good">Official channel</Badge>
            )}
          </div>

          {channel.url ? (
            <a
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {new URL(channel.url).hostname}
              <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}

          {channel.value ? (
            <p className="mt-2 text-sm font-semibold tabular-nums text-ink">
              <a href={`tel:${channel.value}`} className="text-accent underline underline-offset-2">
                {channel.value}
              </a>
            </p>
          ) : null}

          {channel.note ? <p className="mt-2 text-xs leading-relaxed text-ink-muted">{channel.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function Escalation({ steps }: { steps: EscalationStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-ink-muted">You have worked through every escalation step we can suggest.</p>;
  }
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.level} className="rounded-xl border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Step {step.level}</Badge>
            <p className="text-sm font-semibold text-ink">{step.title}</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
          <p className="mt-2 text-xs text-ink-faint">
            Appropriate from about {step.afterDays} days after you submitted
            {step.authorityHint ? ` · ${step.authorityHint}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function PlanView({
  plan,
  /** Extra notice rendered above the plan, e.g. the AI-fallback note. */
  notice,
}: {
  plan: ResolutionPlan;
  notice?: React.ReactNode;
}) {
  const urgencyTone: Tone = URGENCY_TONE[plan.urgency];

  return (
    <div className="space-y-5">
      {notice}

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="What happened"
          aside={
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{plan.categoryLabel}</Badge>
              <Badge tone={urgencyTone}>{URGENCY_LABEL[plan.urgency]}</Badge>
            </div>
          }
        />
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{plan.whatHappened}</p>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Who handles this" description={plan.authority.scope} />
        <p className="mt-3 text-[15px] font-medium text-ink">{plan.authority.name}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-soft">What you are asking for: </span>
          {plan.requestedAction}
        </p>
        {plan.authority.isSample ? <div className="mt-3"><SampleNote>{plan.authority.sourceNote}</SampleNote></div> : null}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="What you need" description="An official will ask for these." />
        <div className="mt-4">
          <EvidenceChecklist items={plan.evidence} />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="What happens next"
          description={`Acknowledgement usually takes about ${plan.expectedAcknowledgementDays} day(s); resolution about ${plan.expectedResolutionDays} days.`}
        />
        <div className="mt-5">
          <Timeline steps={plan.steps} />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="Where to submit it" description="You submit this yourself — CivicSOS does not file it for you." />
        <div className="mt-4">
          <Channels channels={plan.submissionChannels} />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title="After you submit" />
        <ul className="mt-4 space-y-2.5">
          {plan.afterSubmission.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-relaxed text-ink-muted">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="If nothing happens"
          description={plan.followUpAt ? `We suggest following up around ${formatDate(plan.followUpAt)}.` : undefined}
        />
        <div className="mt-4">
          <Escalation steps={plan.escalation} />
        </div>
      </Card>

      <AlertIsh>{plan.disclaimer}</AlertIsh>
    </div>
  );
}

/** The honesty disclaimer, rendered with every plan. */
function AlertIsh({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-soft p-4 text-xs leading-relaxed text-ink-muted">
      <p className="mb-1 font-semibold text-ink-soft">Please read</p>
      {children}
    </div>
  );
}
