import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { IconArrowRight, IconCheck, IconInfo } from './icons';

/**
 * CivicSOS component primitives.
 *
 * A small set of well-made pieces the screens compose directly, rather than a
 * deep abstraction layer. Everything is light-mode only, mobile-first, and meets
 * WCAG AA contrast against the tokens in `globals.css`.
 *
 * Interaction rules, applied consistently: a resting shadow on cards, a lifted
 * shadow plus a 1px rise on hover for anything clickable, a 150ms colour
 * transition on controls, and a visible focus ring on everything focusable.
 */

export type Tone = 'neutral' | 'accent' | 'teal' | 'good' | 'warn' | 'gold' | 'bad';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft ring-line-strong',
  accent: 'bg-accent-soft text-accent-ink ring-accent-line',
  teal: 'bg-teal-soft text-teal ring-teal-line',
  good: 'bg-good-soft text-good ring-good-line',
  warn: 'bg-warn-soft text-warn ring-warn-line',
  gold: 'bg-gold-soft text-gold ring-gold-line',
  bad: 'bg-bad-soft text-bad ring-bad-line',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_CHIP[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** A small filled dot, for status indication next to a label. */
export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const colour: Record<Tone, string> = {
    neutral: 'bg-ink-faint',
    accent: 'bg-accent',
    teal: 'bg-teal',
    good: 'bg-good',
    warn: 'bg-warn',
    gold: 'bg-gold',
    bad: 'bg-bad',
  };
  return <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${colour[tone]}`} />;
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  /** Adds the hover lift. Only for cards that are actually clickable. */
  interactive?: boolean;
}) {
  return (
    <Tag
      className={`rounded-2xl border border-line bg-surface shadow-card ${
        interactive
          ? 'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-lift'
          : ''
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-accent text-white shadow-card hover:bg-accent-hover active:bg-accent-press disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none',
  secondary:
    'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-soft hover:ring-ink-faint active:bg-surface-sunken disabled:text-ink-faint',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft active:bg-accent-line/60 disabled:text-ink-faint',
  subtle: 'bg-surface-sunken text-ink-soft hover:bg-line active:bg-line-strong disabled:text-ink-faint',
  danger: 'bg-surface text-bad ring-1 ring-inset ring-bad-line hover:bg-bad-soft active:bg-bad-soft',
} as const;

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
  xl: 'h-14 px-7 text-base gap-2.5',
} as const;

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-xl font-medium transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.99] disabled:cursor-not-allowed disabled:active:scale-100';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
  full?: boolean;
  icon?: ReactNode;
  /** Icon shown after the label — usually an arrow on a forward action. */
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  icon,
  trailingIcon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      // `aria-busy` tells assistive tech the control is working; a spinner alone
      // says nothing to a screen reader.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}

/** A link styled as a button. Keeps link semantics for navigation. */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  full = false,
  icon,
  trailingIcon,
  className = '',
  children,
  ...rest
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  full?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link
      href={href}
      {...rest}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {icon}
      {children}
      {trailingIcon}
    </Link>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  labelAside,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
  labelAside?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
          {required ? (
            <span className="ml-1 text-bad" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {labelAside}
      </div>
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        // `role="alert"` so the message is announced the moment it appears.
        <p id={`${htmlFor}-error`} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none disabled:bg-surface-sunken disabled:text-ink-muted';

export function Input({ className = '', invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL_CLASS} ${invalid ? 'border-bad focus:border-bad focus:ring-bad-soft' : ''} ${className}`}
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
      className={`${CONTROL_CLASS} resize-y leading-relaxed ${invalid ? 'border-bad focus:border-bad focus:ring-bad-soft' : ''} ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

const ALERT_TONE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-soft',
  accent: 'border-accent-line bg-accent-soft',
  teal: 'border-teal-line bg-teal-soft',
  good: 'border-good-line bg-good-soft',
  warn: 'border-warn-line bg-warn-soft',
  gold: 'border-gold-line bg-gold-soft',
  bad: 'border-bad-line bg-bad-soft',
};

const ALERT_ICON_TONE: Record<Tone, string> = {
  neutral: 'text-ink-muted',
  accent: 'text-accent',
  teal: 'text-teal',
  good: 'text-good',
  warn: 'text-warn',
  gold: 'text-gold',
  bad: 'text-bad',
};

export function Alert({
  tone = 'neutral',
  title,
  children,
  action,
  icon,
  className = '',
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Errors are announced assertively; informational notes politely.
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`fade-in rounded-2xl border p-4 text-sm text-ink-soft ${ALERT_TONE[tone]} ${className}`}
    >
      <div className="flex gap-3">
        <span className={`mt-0.5 shrink-0 ${ALERT_ICON_TONE[tone]}`} aria-hidden="true">
          {icon ?? <IconInfo className="h-[18px] w-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold text-ink">{title}</p> : null}
          {children ? <div className={title ? 'mt-1 leading-relaxed' : 'leading-relaxed'}>{children}</div> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
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
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-ink-faint shadow-card"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function CaseListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your cases</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} className="p-5">
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout and data display                                            */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold tracking-tight text-ink sm:text-lg">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/** Compact metric tile used on the dashboards. */
export function Stat({
  label,
  value,
  tone = 'neutral',
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  hint?: string;
}) {
  const valueTone: Record<Tone, string> = {
    neutral: 'text-ink',
    accent: 'text-accent',
    teal: 'text-teal',
    good: 'text-good',
    warn: 'text-warn',
    gold: 'text-gold',
    bad: 'text-bad',
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        {icon ? (
          <span aria-hidden="true" className={`${valueTone[tone]} opacity-70`}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-[28px] ${valueTone[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}

/** Horizontal progress bar. Announces its value to assistive tech. */
export function ProgressBar({
  value,
  tone = 'accent',
  label,
  className = '',
}: {
  /** 0–1. */
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill: Record<Tone, string> = {
    neutral: 'bg-ink-faint',
    accent: 'bg-accent',
    teal: 'bg-teal',
    good: 'bg-good',
    warn: 'bg-warn',
    gold: 'bg-gold',
    bad: 'bg-bad',
  };

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-2 overflow-hidden rounded-full bg-surface-sunken ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${fill[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Initial-based avatar. No image hosting, no upload, no broken images. */
export function Avatar({
  name,
  size = 'md',
  className = '',
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

  const sizes = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-base',
    xl: 'h-20 w-20 text-2xl',
  } as const;

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-ink ring-1 ring-inset ring-accent-line ${sizes[size]} ${className}`}
    >
      {initials}
    </span>
  );
}

/** Scrollable pill filter rail. Wraps on desktop, scrolls on mobile. */
export function FilterRail<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
              selected
                ? 'border-accent bg-accent text-white'
                : 'border-line-strong bg-surface text-ink-soft hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink'
            }`}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={`ml-1.5 tabular-nums ${selected ? 'text-white/70' : 'text-ink-faint'}`}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Honesty markers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Marks content that comes from seeded demo data.
 *
 * Deliberately conspicuous: the product's credibility rests on nobody ever
 * mistaking a demo case for a real one.
 */
export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <Badge tone="warn" className={className} icon={<Dot tone="warn" />}>
      Demo data
    </Badge>
  );
}

/** Marks information that is generic guidance, not a verified directory. */
export function SampleNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-xl bg-surface-sunken px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
      <IconInfo className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Inline "+N Civic Points" marker. Small by design — a nudge, not a trophy. */
export function PointsPill({
  points,
  className = '',
  size = 'sm',
}: {
  points: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (points <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gold-soft font-semibold text-gold ring-1 ring-inset ring-gold-line ${
        size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      } ${className}`}
    >
      <IconCheck className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} />+{points}
      <span className="font-normal">pts</span>
    </span>
  );
}

export { IconArrowRight };
