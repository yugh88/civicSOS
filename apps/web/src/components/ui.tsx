import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/**
 * The CivicSOS component primitives.
 *
 * Small and unabstracted on purpose: a handful of well-made pieces that the
 * screens compose directly. Everything is light-mode only, mobile-first, and
 * built to meet WCAG AA contrast with the tokens in `globals.css`.
 */

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft ring-line',
  accent: 'bg-accent-soft text-accent ring-accent-line',
  good: 'bg-good-soft text-good ring-good-line',
  warn: 'bg-warn-soft text-warn ring-warn-line',
  bad: 'bg-bad-soft text-bad ring-bad-line',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_CHIP[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag
      className={`rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
    >
      {children}
    </Tag>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-hover disabled:bg-line-strong disabled:text-ink-faint',
  secondary:
    'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-soft disabled:text-ink-faint',
  ghost:
    'bg-transparent text-accent hover:bg-accent-soft disabled:text-ink-faint',
  danger:
    'bg-surface text-bad ring-1 ring-inset ring-bad-line hover:bg-bad-soft',
} as const;

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-6 text-base',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
  full?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      // `aria-busy` tells assistive tech the control is working, which a
      // spinner alone does not.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-bad">*</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        // `role="alert"` so the message is announced when it appears.
        <p id={errorId} role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-line focus:outline-none disabled:bg-surface-sunken disabled:text-ink-muted';

export function Input({ className = '', invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL_CLASS} ${invalid ? 'border-bad' : ''} ${className}`}
    />
  );
}

export function Textarea({
  className = '',
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL_CLASS} resize-y leading-relaxed ${invalid ? 'border-bad' : ''} ${className}`}
    />
  );
}

const ALERT_TONE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-soft text-ink-soft',
  accent: 'border-accent-line bg-accent-soft text-ink',
  good: 'border-good-line bg-good-soft text-ink',
  warn: 'border-warn-line bg-warn-soft text-ink',
  bad: 'border-bad-line bg-bad-soft text-ink',
};

export function Alert({
  tone = 'neutral',
  title,
  children,
  action,
  className = '',
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Errors and warnings need to be announced; informational notes do not.
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm ${ALERT_TONE[tone]} ${className}`}
    >
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-soft px-6 py-14 text-center">
      {icon ? (
        <div aria-hidden="true" className="text-3xl">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** Loading placeholder for a list of cases. */
export function CaseListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your cases</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} className="p-5">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  aside,
  id,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/**
 * Marks content that comes from seeded demo data.
 *
 * Deliberately conspicuous: the product's credibility depends on nobody ever
 * mistaking a demo case for a real one.
 */
export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <Badge tone="warn" className={className}>
      <span aria-hidden="true">●</span> Demo data
    </Badge>
  );
}

/** Marks information that is generic guidance rather than a verified directory. */
export function SampleNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-muted">
      <span aria-hidden="true">ℹ️</span>
      <span>{children}</span>
    </p>
  );
}
