import type { AuthContext, Redemption, RewardRecord } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { AppError } from '../domain/errors.js';
import { REWARDS, REWARDS_DISCLAIMER, getReward } from '../knowledge/rewards.js';
import { levelProgress, meetsLevel } from '../rules/points.js';
import { PointsService } from './points-service.js';
import { timeOrderedId } from '../domain/ids.js';
import { isoNow } from '../util/time.js';

/**
 * Rewards service.
 *
 * The catalogue is data (see `knowledge/rewards.ts`), the affordability and
 * eligibility checks are server-side, and redemption debits through the points
 * ledger. No commerce API, no payment flow, no paid dependency: issuing a code
 * is a single function that a real deployment swaps for a partner integration.
 */

export interface RewardView extends RewardRecord {
  /** Whether this user can redeem it right now. */
  affordable: boolean;
  eligible: boolean;
  /** Points still needed, 0 when affordable. */
  pointsShort: number;
  /** Why it cannot be redeemed, for the UI to show instead of a dead button. */
  lockedReason?: string;
}

export interface RewardsOverview {
  balance: number;
  lifetimePoints: number;
  level: ReturnType<typeof levelProgress>;
  rewards: RewardView[];
  redemptions: Redemption[];
  disclaimer: string;
  /** True while the shipped placeholder catalogue is in use. */
  isSampleCatalog: boolean;
}

export class RewardsService {
  private readonly points: PointsService;

  constructor(private readonly ctx: ServiceContext) {
    this.points = new PointsService(ctx);
  }

  async overview(auth: AuthContext): Promise<RewardsOverview> {
    const profile = await this.points.profileOf(auth.userId, { email: auth.email, role: auth.role });
    const progress = levelProgress(profile.lifetimePoints);
    const redemptions = await this.ctx.repository.listRedemptions(auth.userId, 20);

    const rewards: RewardView[] = REWARDS.map((reward) => {
      const affordable = profile.civicPoints >= reward.pointsRequired;
      const eligible = meetsLevel(progress.level.id, reward.minLevel);
      const pointsShort = Math.max(0, reward.pointsRequired - profile.civicPoints);

      return {
        ...reward,
        affordable,
        eligible,
        pointsShort,
        lockedReason: !eligible
          ? `Reach ${reward.minLevel === 'SILVER' ? 'Silver Citizen' : reward.minLevel === 'GOLD' ? 'Gold Citizen' : 'a higher level'} to unlock this.`
          : !affordable
            ? `${pointsShort} more points needed.`
            : undefined,
      };
    });

    return {
      balance: profile.civicPoints,
      lifetimePoints: profile.lifetimePoints,
      level: progress,
      rewards,
      redemptions,
      disclaimer: REWARDS_DISCLAIMER,
      isSampleCatalog: REWARDS.some((reward) => reward.isSampleCatalog),
    };
  }

  async redeem(auth: AuthContext, rewardId: string): Promise<{ redemption: Redemption; balance: number }> {
    const reward = getReward(rewardId);
    if (!reward) throw AppError.notFound("We couldn't find that reward.");

    const profile = await this.points.profileOf(auth.userId);
    const progress = levelProgress(profile.lifetimePoints);

    if (!meetsLevel(progress.level.id, reward.minLevel)) {
      throw AppError.forbidden('You have not reached the citizen level this reward needs yet.');
    }
    if (profile.civicPoints < reward.pointsRequired) {
      throw AppError.conflict(
        `You need ${reward.pointsRequired - profile.civicPoints} more Civic Points for this reward.`,
      );
    }

    // Debit first. If the debit fails the balance moved underneath us, and no
    // redemption is recorded.
    const spent = await this.points.spend(auth.userId, reward.pointsRequired, reward.rewardId, reward.name);
    if (!spent) throw AppError.conflict('Your points balance changed. Please try again.');

    const now = this.ctx.clock.now();
    const redemption: Redemption = {
      redemptionId: timeOrderedId('rdm', now),
      userId: auth.userId,
      rewardId: reward.rewardId,
      rewardName: reward.name,
      pointsSpent: reward.pointsRequired,
      code: this.issueCode(reward, now),
      createdAt: isoNow(now),
    };

    await this.ctx.repository.putRedemption(redemption);
    await this.ctx.audit.record({
      auth,
      action: 'REWARD_REDEEM',
      resource: `reward/${reward.rewardId}`,
      outcome: 'ALLOW',
      detail: `points=${reward.pointsRequired}`,
    });

    const updated = await this.ctx.repository.getUser(auth.userId);
    return { redemption, balance: updated?.civicPoints ?? 0 };
  }

  /**
   * Issues a redemption code.
   *
   * The placeholder catalogue produces an obviously-fake `DEMO-` code, so a code
   * on screen can never be mistaken for something of value. This is the single
   * function a real deployment replaces with a partner integration.
   */
  private issueCode(reward: RewardRecord, now: Date): string {
    const suffix = timeOrderedId('c', now).slice(-6).toUpperCase();
    const prefix = reward.isSampleCatalog ? 'DEMO' : reward.partner.slice(0, 4).toUpperCase();
    return `${prefix}-${reward.category.slice(0, 3)}-${suffix}`;
  }
}
