'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApi, useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { RedeemResponse, RewardView, RewardsResponse } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  FilterRail,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Skeleton,
} from '@/components/ui';
import { IconArrowRight, IconCheck, IconRewards, IconSparkle } from '@/components/icons';

/**
 * Rewards.
 *
 * Points are earned for useful civic participation and spent here. Everything
 * that matters — the balance, eligibility, the debit — is decided server-side;
 * this page reflects that decision and shows *why* a reward is locked rather
 * than presenting a dead button.
 *
 * The catalogue shipped with the project is a placeholder with fictional
 * partners, and says so prominently. CivicSOS has no confirmed sponsors.
 */

type FilterId = 'ALL' | 'VOUCHER' | 'PRODUCT' | 'EXPERIENCE';

export default function RewardsPage() {
  const { session, loading: sessionLoading } = useAuth();
  const api = useApi();
  const router = useRouter();

  const [data, setData] = useState<RewardsResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<FilterId>('ALL');
  const [redeeming, setRedeeming] = useState<string | undefined>();
  const [redeemed, setRedeemed] = useState<RedeemResponse | undefined>();
  const [redeemError, setRedeemError] = useState<string | undefined>();

  useEffect(() => {
    if (!sessionLoading && !session) router.replace('/signin?next=/rewards');
  }, [router, session, sessionLoading]);

  const load = useCallback(async () => {
    try {
      setData(await api<RewardsResponse>('/rewards'));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load rewards.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (session) void load();
  }, [load, session]);

  const redeem = useCallback(
    async (reward: RewardView) => {
      setRedeeming(reward.rewardId);
      setRedeemError(undefined);
      setRedeemed(undefined);
      try {
        const result = await api<RedeemResponse>(`/rewards/${reward.rewardId}/redeem`, { method: 'POST', body: {} });
        setRedeemed(result);
        await load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (caught) {
        setRedeemError(caught instanceof Error ? caught.message : 'We could not redeem that.');
      } finally {
        setRedeeming(undefined);
      }
    },
    [api, load],
  );

  if (sessionLoading || (loading && session)) {
    return (
      <div className="space-y-7" aria-busy="true">
        <PageHeader title="Rewards" description="Turn your civic actions into rewards." />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-52 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) return null;

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Rewards" />
        <Alert
          tone="bad"
          title="We could not load rewards"
          action={
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          }
        >
          {error ?? 'Please try again in a moment.'}
        </Alert>
      </div>
    );
  }

  const visible = data.rewards.filter((reward) => filter === 'ALL' || reward.category === filter);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Rewards"
        description="Turn your civic actions into rewards. Points come from reporting real problems and seeing them through."
      />

      {redeemed ? (
        <Alert tone="good" title="Redeemed" icon={<IconCheck className="h-[18px] w-[18px]" />}>
          <p>
            <span className="font-medium">{redeemed.redemption.rewardName}</span> — your code is{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{redeemed.redemption.code}</code>. New
            balance: {redeemed.balance.toLocaleString()} points.
          </p>
          <p className="mt-1.5 text-xs text-ink-muted">
            This is a sample code from the demo catalogue and has no monetary value.
          </p>
        </Alert>
      ) : null}

      {redeemError ? (
        <Alert tone="bad" title="We could not redeem that">
          {redeemError}
        </Alert>
      ) : null}

      <BalanceCard data={data} />

      <Alert tone="warn" title="Demo catalogue">
        {data.disclaimer}
      </Alert>

      <div className="space-y-5">
        <SectionHeading title="Available rewards" description="Redeem with the points you have earned." />

        <FilterRail<FilterId>
          label="Filter rewards"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'ALL', label: 'All', count: data.rewards.length },
            { id: 'VOUCHER', label: 'Vouchers', count: data.rewards.filter((r) => r.category === 'VOUCHER').length },
            { id: 'PRODUCT', label: 'Products', count: data.rewards.filter((r) => r.category === 'PRODUCT').length },
            {
              id: 'EXPERIENCE',
              label: 'Experiences',
              count: data.rewards.filter((r) => r.category === 'EXPERIENCE').length,
            },
          ]}
        />

        {visible.length === 0 ? (
          <EmptyState
            icon={<IconRewards className="h-6 w-6" />}
            title="Nothing in this category"
            description="Try a different category above."
          />
        ) : (
          <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((reward) => (
              <RewardCard
                key={reward.rewardId}
                reward={reward}
                busy={redeeming === reward.rewardId}
                disabled={Boolean(redeeming)}
                onRedeem={() => redeem(reward)}
              />
            ))}
          </ul>
        )}
      </div>

      {data.redemptions.length > 0 ? (
        <div className="space-y-4">
          <SectionHeading title="Your redemptions" description="Codes you have already claimed." />
          <ul className="space-y-2.5">
            {data.redemptions.map((entry) => (
              <Card as="li" key={entry.redemptionId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{entry.rewardName}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatDate(entry.createdAt)} · {entry.pointsSpent} points
                  </p>
                </div>
                <code className="rounded-lg bg-surface-sunken px-2.5 py-1.5 font-mono text-xs text-ink-soft">
                  {entry.code}
                </code>
              </Card>
            ))}
          </ul>
        </div>
      ) : null}

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="max-w-md">
          <h3 className="text-base font-semibold text-ink">Need more points?</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            Reporting a problem earns 50, completing every detail earns 10, adding evidence earns 10, and a problem
            actually getting resolved earns 100.
          </p>
        </div>
        <ButtonLink href="/report" trailingIcon={<IconArrowRight className="h-[18px] w-[18px]" />}>
          Report a problem
        </ButtonLink>
      </Card>
    </div>
  );
}

function BalanceCard({ data }: { data: RewardsResponse }) {
  const { level } = data;
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10 sm:p-7">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Your balance</p>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums tracking-tight text-gold">
              {data.balance.toLocaleString()}
            </span>
            <span className="text-sm font-medium text-ink-muted">Civic Points</span>
          </p>
          <Badge tone="gold" className="mt-3" icon={<IconSparkle className="h-3.5 w-3.5" />}>
            {level.level.label}
          </Badge>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-ink">{level.level.label}</span>
            {level.next ? <span className="text-ink-muted">{level.next.label}</span> : null}
          </div>
          <ProgressBar
            value={level.progress}
            tone="gold"
            className="mt-2"
            label={`Progress to ${level.next?.label ?? 'the top level'}`}
          />
          <p className="mt-2.5 text-sm text-ink-muted">
            {level.next ? (
              <>
                You&apos;re <span className="font-semibold text-ink">{level.pointsToNext} points</span> away from{' '}
                {level.next.label}.
              </>
            ) : (
              'You have reached the highest citizen level.'
            )}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {data.lifetimePoints.toLocaleString()} points earned in total. Redeeming spends your balance but never
            lowers your level.
          </p>
        </div>
      </div>
    </Card>
  );
}

const CATEGORY_LABEL: Record<RewardView['category'], string> = {
  VOUCHER: 'Voucher',
  PRODUCT: 'Product',
  EXPERIENCE: 'Experience',
};

function RewardCard({
  reward,
  busy,
  disabled,
  onRedeem,
}: {
  reward: RewardView;
  busy: boolean;
  disabled: boolean;
  onRedeem: () => void;
}) {
  const locked = !reward.affordable || !reward.eligible;

  return (
    <Card as="li" className="flex list-none flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-sunken text-xl"
        >
          {reward.emoji}
        </span>
        <Badge tone="neutral">{CATEGORY_LABEL[reward.category]}</Badge>
      </div>

      <p className="mt-4 text-xs font-medium text-ink-faint">{reward.partner}</p>
      <h3 className="mt-1 text-[15px] font-semibold leading-snug text-ink">{reward.name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">{reward.description}</p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm font-semibold tabular-nums text-gold">
          {reward.pointsRequired.toLocaleString()}
          <span className="ml-1 font-normal text-ink-muted">pts</span>
        </span>
        <Button
          size="sm"
          variant={locked ? 'subtle' : 'primary'}
          disabled={locked || disabled}
          loading={busy}
          onClick={onRedeem}
        >
          {locked ? 'Locked' : 'Redeem'}
        </Button>
      </div>

      {/* Explain the lock rather than leaving a dead control. */}
      {reward.lockedReason ? <p className="mt-2 text-xs text-ink-muted">{reward.lockedReason}</p> : null}
    </Card>
  );
}
