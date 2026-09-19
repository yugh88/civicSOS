'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CATEGORY_ALT, CATEGORY_BLURB, categoryArt } from '@/lib/category-art';
import type { KnowledgeResponse } from '@/lib/types';
import { ButtonLink, Card, Skeleton } from '@/components/ui';
import {
  CategoryIcon,
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconReport,
  IconSparkle,
  IconStar,
} from '@/components/icons';

/**
 * Home — the landing surface.
 *
 * Its whole job is to make the next step obvious. Everything funnels to
 * `/report`; the product has exactly one primary action and this page does not
 * compete with it.
 */

export default function HomePage() {
  const { session } = useAuth();
  const [knowledge, setKnowledge] = useState<KnowledgeResponse | undefined>();

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

  return (
    <div className="space-y-12 sm:space-y-16">
      <Hero signedIn={Boolean(session)} />
      <HowItHelps />
      <Categories knowledge={knowledge} />
      <ClosingCta />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero-wash -mx-4 -mt-8 rounded-b-[2rem] px-4 pb-10 pt-10 sm:-mx-6 sm:-mt-10 sm:px-6 sm:pb-12 sm:pt-14">
      <div className="rise grid items-center gap-8 md:grid-cols-2 lg:grid-cols-[1.35fr_1fr_0.9fr] lg:gap-8">
        {/* Copy ------------------------------------------------------- */}
        <div className="max-w-xl">
          <h1 className="text-[32px] font-semibold leading-[1.08] tracking-tight text-ink sm:text-[42px]">
            Your civic problem.
            <br />
            <span className="text-accent">Our agent.</span>
          </h1>

          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted sm:text-base">
            Tell CivicSOS what happened. It figures out where it belongs, prepares the complaint, handles supported
            submissions, and keeps following up.
          </p>

          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <ButtonLink
              href="/report"
              size="lg"
              className="whitespace-nowrap"
              trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}
            >
              Report a problem
            </ButtonLink>
            <ButtonLink
              href={signedIn ? '/cases' : '/signin?demo=1'}
              size="lg"
              variant="secondary"
              className="whitespace-nowrap"
            >
              {signedIn ? 'View my cases' : 'Try the demo'}
            </ButtonLink>
          </div>
        </div>

        {/* Decorative: the surrounding copy already says all of this. */}
        <img
          src="/illustrations/hero.svg"
          alt=""
          width={560}
          height={400}
          className="mx-auto w-full max-w-sm sm:max-w-md lg:max-w-none"
        />

        <ValueCard className="md:col-span-2 lg:col-span-1" />
      </div>

      {/* Stats get their own row so the labels never have to truncate. */}
      <ImpactStrip />
    </section>
  );
}

/**
 * Community impact.
 *
 * Illustrative figures for the hackathon build, and labelled as such — CivicSOS
 * does not present demo numbers as live platform statistics anywhere.
 */
function ImpactStrip() {
  const stats = [
    { value: '1,240', label: 'Problems reported', icon: <IconReport className="h-4 w-4" />, tone: 'accent' as const },
    { value: '892', label: 'Resolved', icon: <IconCheck className="h-4 w-4" />, tone: 'teal' as const },
    { value: '4.8', label: 'User rating', icon: <IconStar className="h-4 w-4" />, tone: 'gold' as const },
    { value: 'Cleaner', label: 'safer communities', icon: <IconSparkle className="h-4 w-4" />, tone: 'teal' as const },
  ];

  const tones = {
    accent: 'bg-accent-soft text-accent',
    teal: 'bg-teal-soft text-teal',
    gold: 'bg-gold-soft text-gold',
  };

  return (
    <>
      <ul className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {stats.map((stat) => (
          <li
            key={stat.label}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 p-3.5 backdrop-blur-sm"
          >
            <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[stat.tone]}`}>
              {stat.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold tabular-nums leading-tight text-ink">{stat.value}</span>
              <span className="block text-xs leading-tight text-ink-muted">{stat.label}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[11px] text-ink-faint">Illustrative figures for this build, not live statistics.</p>
    </>
  );
}

function ValueCard({ className = '' }: { className?: string }) {
  const points = [
    { text: 'Finds the responsible authority', icon: <IconReport className="h-4 w-4" />, tone: 'accent' as const },
    { text: 'Checks your evidence is enough', icon: <IconCheck className="h-4 w-4" />, tone: 'teal' as const },
    { text: 'Prepares and submits the complaint', icon: <IconClock className="h-4 w-4" />, tone: 'accent' as const },
    { text: 'Follows up and escalates for you', icon: <IconStar className="h-4 w-4" />, tone: 'gold' as const },
  ];

  const tones = {
    accent: 'bg-accent-soft text-accent',
    teal: 'bg-teal-soft text-teal',
    gold: 'bg-gold-soft text-gold',
  };

  return (
    <Card className={`p-5 sm:p-6 ${className}`}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <IconSparkle aria-hidden="true" className="h-[18px] w-[18px] text-teal" />
        What CivicSOS does for you
      </h2>

      <ul className="mt-4 space-y-3">
        {points.map((point) => (
          <li key={point.text} className="flex items-center gap-3 text-sm text-ink-soft">
            <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tones[point.tone]}`}>
              {point.icon}
            </span>
            {point.text}
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-xl bg-accent-soft/70 p-4 text-[13px] leading-relaxed text-ink-soft">
        You approve every action before it happens. CivicSOS never files anything without you saying so.
      </p>
    </Card>
  );
}

function HowItHelps() {
  const steps = [
    { title: 'Tell us', detail: 'Describe the problem and add a photo. No forms, no department names to look up.' },
    { title: 'We handle it', detail: 'CivicSOS works out the route, prepares the complaint and submits it once you approve.' },
    { title: 'We follow up', detail: 'It remembers the case, watches for a response and handles the next step.' },
  ];

  return (
    <section aria-labelledby="how" className="space-y-5">
      <h2 id="how" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
        How CivicSOS helps
      </h2>
      <ol className="stagger grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <Card key={step.title} as="li" className="p-5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-[15px] font-bold text-accent"
            >
              {index + 1}
            </span>
            <h3 className="mt-3.5 text-[15px] font-semibold text-ink">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
          </Card>
        ))}
      </ol>
    </section>
  );
}

function Categories({ knowledge }: { knowledge?: KnowledgeResponse }) {
  return (
    <section aria-labelledby="categories" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="categories" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            What can you report?
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Pick a category to start, or just describe the problem in your own words.
          </p>
        </div>
        <Link
          href="/report"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          View all categories
          <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {!knowledge ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {knowledge.categories.map((category) => (
            <Card key={category.categoryId} as="li" interactive className="group list-none">
              <Link href={`/report?category=${encodeURIComponent(category.categoryId)}`} className="block">
                <span className="relative block">
                  {/* Only the image clips, so the badge below can overhang it. */}
                  <span className="block aspect-[16/9] overflow-hidden rounded-t-2xl bg-surface-sunken">
                    <img
                      src={categoryArt(category.categoryId)}
                      alt={CATEGORY_ALT[category.categoryId] ?? category.label}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  {/* Icon badge straddles the image edge, as in the reference. */}
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-5 left-4 flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-accent shadow-card ring-1 ring-line"
                  >
                    <CategoryIcon categoryId={category.categoryId} className="h-[22px] w-[22px]" />
                  </span>
                </span>

                <span className="block px-4 pb-4 pt-7">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-ink">{category.label}</span>
                    <IconChevronRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-ink-muted">
                    {CATEGORY_BLURB[category.categoryId] ?? category.description}
                  </span>
                </span>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="overflow-hidden rounded-3xl border border-accent-line bg-accent-soft">
      <div className="flex flex-wrap items-center justify-between gap-6 p-7 sm:p-9">
        <div className="max-w-lg">
          <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Something broken on your street right now?
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            One sentence and a photo is all it takes. CivicSOS does the rest and stays with it until it is fixed.
          </p>
        </div>
        <ButtonLink href="/report" size="lg" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
          Report a problem
        </ButtonLink>
      </div>
    </section>
  );
}
