'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { KnowledgeResponse } from '@/lib/types';
import { Badge, ButtonLink, Card, Dot, SectionHeading, Skeleton } from '@/components/ui';
import { CategoryIcon, IconArrowRight, IconChevronRight, IconShield, IconSparkle, IconStar, IconUsers } from '@/components/icons';

/**
 * Home.
 *
 * The landing surface: what CivicSOS is, one obvious way in, and the categories
 * it covers. Everything here funnels to `/report` — the product has exactly one
 * primary action and this page does not compete with it.
 */

const CATEGORY_BLURBS: Record<string, string> = {
  ROAD_DAMAGE: 'Potholes, broken footpaths, open manholes',
  GARBAGE_SANITATION: 'Uncollected waste, overflowing bins, dumping',
  STREETLIGHT: 'Dark streets, broken lamps, exposed wiring',
  WATER_SEWERAGE: 'No supply, leaks, contamination, blocked drains',
  PUBLIC_SAFETY_HAZARD: 'Fallen trees, live wires, unsafe structures',
  OTHER: 'Anything else your local body should handle',
};

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
    <div className="space-y-14 sm:space-y-20">
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="hero-wash -mx-4 -mt-8 rounded-b-[2rem] px-4 pb-12 pt-12 sm:-mx-6 sm:-mt-10 sm:px-6 sm:pb-16 sm:pt-16">
        <div className="rise mx-auto max-w-3xl text-center">
          <Badge tone="accent" icon={<Dot tone="accent" />} className="mb-5">
            Civic reporting, made obvious
          </Badge>

          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            See a problem?
            <br />
            <span className="text-accent">Let&apos;s solve it together.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-ink-muted sm:text-[17px]">
            Report civic issues in seconds, get guidance, track progress, and help build a better community.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/report" size="xl" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
              Help me solve a problem
            </ButtonLink>
            {!session ? (
              <ButtonLink href="/signin?demo=1" size="xl" variant="secondary">
                Try the demo
              </ButtonLink>
            ) : (
              <ButtonLink href="/cases" size="xl" variant="secondary">
                My cases
              </ButtonLink>
            )}
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 text-xs text-ink-muted">
            <IconShield className="h-4 w-4 text-teal" />
            No forms to start. We strip personal details before any AI sees your text.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Categories                                                       */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="categories" className="space-y-5">
        <SectionHeading
          id="categories"
          title="What can you report?"
          description="Pick one to start, or just describe the problem in your own words."
        />

        {!knowledge ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {knowledge.categories.map((category) => (
              <Card key={category.categoryId} as="li" interactive className="list-none">
                <Link
                  href={`/report?category=${encodeURIComponent(category.categoryId)}`}
                  className="flex h-full items-start gap-4 p-5"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
                  >
                    <CategoryIcon categoryId={category.categoryId} className="h-[22px] w-[22px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                      {category.label}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-muted">
                      {CATEGORY_BLURBS[category.categoryId] ?? category.description}
                    </span>
                  </span>
                  <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" />
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="how" className="space-y-5">
        <SectionHeading id="how" title="How CivicSOS works" description="Three steps. No jargon, no forms to hunt down." />
        <ol className="stagger grid gap-3 sm:grid-cols-3">
          {[
            {
              title: 'You describe it',
              detail: 'Plain words. No forms, no department names to look up, no process to learn.',
            },
            {
              title: 'We work out the route',
              detail: 'Which body handles it, what evidence they need, and a complaint ready to send.',
            },
            {
              title: 'You submit, we track',
              detail: 'You file it officially. We remind you when to chase it and how to escalate.',
            },
          ].map((step, index) => (
            <Card key={step.title} as="li" className="p-5">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold text-accent"
              >
                {index + 1}
              </span>
              <h3 className="mt-3.5 text-[15px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
            </Card>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Community impact                                                 */}
      {/* ---------------------------------------------------------------- */}
      <ImpactSection />

      {/* ---------------------------------------------------------------- */}
      {/* Closing CTA                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="overflow-hidden rounded-3xl border border-accent-line bg-accent-soft">
        <div className="flex flex-wrap items-center justify-between gap-6 p-8 sm:p-10">
          <div className="max-w-lg">
            <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              Something broken on your street right now?
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
              It takes one sentence to start. CivicSOS works out the rest and stays with you until it is fixed.
            </p>
          </div>
          <ButtonLink href="/report" size="lg" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
            Report a problem
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

/**
 * Community impact.
 *
 * These are illustrative figures for the hackathon build, not live platform
 * metrics — so the section says so, in the section itself rather than in a
 * footnote nobody reads.
 */
function ImpactSection() {
  const stats = [
    { value: '1,240', label: 'Problems reported', icon: <IconSparkle className="h-5 w-5" />, tone: 'accent' as const },
    { value: '892', label: 'Problems resolved', icon: <IconShield className="h-5 w-5" />, tone: 'teal' as const },
    { value: '4.8', label: 'Community rating', icon: <IconStar className="h-5 w-5" />, tone: 'gold' as const },
    { value: '3,600', label: 'Active citizens', icon: <IconUsers className="h-5 w-5" />, tone: 'accent' as const },
  ];

  const toneClass = {
    accent: 'text-accent bg-accent-soft',
    teal: 'text-teal bg-teal-soft',
    gold: 'text-gold bg-gold-soft',
  };

  return (
    <section aria-labelledby="impact" className="space-y-5">
      <SectionHeading
        id="impact"
        title="Cleaner, safer communities"
        description="What happens when people know exactly what to do."
        aside={<Badge tone="warn">Illustrative figures</Badge>}
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass[stat.tone]}`}
            >
              {stat.icon}
            </span>
            <p className="mt-3.5 text-2xl font-semibold tabular-nums tracking-tight text-ink sm:text-3xl">{stat.value}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{stat.label}</p>
          </Card>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        These figures illustrate the product for the hackathon build. They are not live platform statistics, and
        CivicSOS does not present demo numbers as real ones anywhere in the app.
      </p>
    </section>
  );
}
