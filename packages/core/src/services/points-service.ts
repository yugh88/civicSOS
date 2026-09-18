import type { CaseRecord, PointReason, PointsEntry, UserProfile } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { POINT_LABELS, POINT_VALUES, awardKey, levelProgress } from '../rules/points.js';
import { timeOrderedId } from '../domain/ids.js';
import { isoNow, unixSeconds, addDays } from '../util/time.js';
import { newNotificationId } from '../domain/ids.js';

/**
 * Civic Points service.
 *
 * Three properties matter, and each is enforced here rather than trusted:
 *
 *  1. **Server-calculated.** Amounts come from `POINT_VALUES`; nothing about
 *     points is ever read from a request body.
 *  2. **Idempotent.** Every award carries a dedupe key of `<reason>#<caseId>`,
 *     written conditionally. A retried request, a double-tapped button or a
 *     replayed event awards nothing the second time.
 *  3. **Duplicate-report resistant.** Case creation is itself idempotent on the
 *     client's key, and the report award is keyed to the resulting case id — so
 *     resubmitting the same report cannot mint a second 50 points.
 *
 * The ledger is the source of truth; the profile counters are a cached balance
 * updated only after the ledger write succeeds.
 */

export interface AwardResult {
  awarded: boolean;
  delta: number;
  reason: PointReason;
  /** Balance after the award, when one happened. */
  balance?: number;
  lifetime?: number;
  /** Set when this award crossed a level boundary. */
  levelUp?: string;
}

export class PointsService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Awards points for a reason, once per case.
   *
   * Returns `awarded: false` for a replay rather than throwing — callers treat
   * awarding as a side effect of the real action, never as its precondition.
   */
  async award(userId: string, reason: PointReason, caseId: string, options: { notify?: boolean } = {}): Promise<AwardResult> {
    const delta = POINT_VALUES[reason];
    if (delta <= 0) return { awarded: false, delta: 0, reason };

    const now = this.ctx.clock.now();
    const entry: PointsEntry = {
      entryId: timeOrderedId('pts', now),
      userId,
      reason,
      delta,
      label: POINT_LABELS[reason],
      caseId,
      dedupeKey: awardKey(reason, caseId),
      createdAt: isoNow(now),
    };

    const written = await this.ctx.repository.putPointsEntry(entry);
    if (!written) {
      this.ctx.logger.debug('points award skipped, already granted', { reason, caseId });
      return { awarded: false, delta: 0, reason };
    }

    const before = await this.ctx.repository.getUser(userId);
    const profile = await this.ctx.repository.bumpUserCounters(userId, {
      civicPoints: delta,
      lifetimePoints: delta,
    });

    const previousLevel = levelProgress(before?.lifetimePoints ?? 0).level;
    const currentLevel = levelProgress(profile.lifetimePoints).level;
    const levelUp = currentLevel.id !== previousLevel.id ? currentLevel.label : undefined;

    this.ctx.logger.info('civic points awarded', { reason, delta, caseId, levelUp: Boolean(levelUp) });

    if (options.notify) {
      await this.notify(
        userId,
        caseId,
        levelUp ? `+${delta} points — you reached ${levelUp}` : `+${delta} Civic Points`,
        levelUp
          ? `${POINT_LABELS[reason]}. You are now a ${levelUp}.`
          : `${POINT_LABELS[reason]}. Balance: ${profile.civicPoints} points.`,
      );
    }

    return {
      awarded: true,
      delta,
      reason,
      balance: profile.civicPoints,
      lifetime: profile.lifetimePoints,
      levelUp,
    };
  }

  /** Awards for a newly created case. Bumps the "reported" impact counter too. */
  async awardForNewCase(record: CaseRecord, completeInformation: boolean): Promise<AwardResult[]> {
    const results: AwardResult[] = [];
    results.push(await this.award(record.ownerId, 'REPORT_CREATED', record.caseId));
    if (completeInformation) {
      results.push(await this.award(record.ownerId, 'COMPLETE_INFORMATION', record.caseId));
    }
    if (results.some((result) => result.awarded)) {
      await this.ctx.repository.bumpUserCounters(record.ownerId, { casesReported: 1 });
    }
    return results;
  }

  async awardForResolution(record: CaseRecord): Promise<AwardResult> {
    const result = await this.award(record.ownerId, 'CASE_RESOLVED', record.caseId, { notify: true });
    if (result.awarded) {
      await this.ctx.repository.bumpUserCounters(record.ownerId, { casesResolved: 1 });
    }
    return result;
  }

  async awardForEvidence(record: CaseRecord): Promise<AwardResult> {
    return this.award(record.ownerId, 'EVIDENCE_PROVIDED', record.caseId);
  }

  /** Spends points. Returns false when the balance is insufficient. */
  async spend(userId: string, amount: number, rewardId: string, rewardName: string): Promise<boolean> {
    const profile = await this.ctx.repository.getUser(userId);
    if (!profile || profile.civicPoints < amount) return false;

    const now = this.ctx.clock.now();
    const written = await this.ctx.repository.putPointsEntry({
      entryId: timeOrderedId('pts', now),
      userId,
      reason: 'REWARD_REDEEMED',
      delta: -amount,
      label: `Redeemed: ${rewardName}`,
      rewardId,
      // Redemptions are intentionally repeatable, so the key is unique per event.
      dedupeKey: `REWARD_REDEEMED#${timeOrderedId('r', now)}`,
      createdAt: isoNow(now),
    });
    if (!written) return false;

    // Only the spendable balance moves. Lifetime points drive the citizen
    // level, so spending must never demote someone.
    await this.ctx.repository.bumpUserCounters(userId, { civicPoints: -amount });
    return true;
  }

  async history(userId: string, limit = 25): Promise<PointsEntry[]> {
    return this.ctx.repository.listPointsEntries(userId, limit);
  }

  /** Reads the profile, materialising defaults for a user who has none yet. */
  async profileOf(userId: string, fallback: Partial<UserProfile> = {}): Promise<UserProfile> {
    const existing = await this.ctx.repository.getUser(userId);
    if (existing) return existing;
    const now = isoNow(this.ctx.clock.now());
    return {
      userId,
      role: 'CITIZEN',
      civicPoints: 0,
      lifetimePoints: 0,
      casesReported: 0,
      casesResolved: 0,
      createdAt: now,
      updatedAt: now,
      ...fallback,
    };
  }

  private async notify(userId: string, caseId: string, title: string, body: string): Promise<void> {
    const now = this.ctx.clock.now();
    await this.ctx.repository.putNotification({
      notificationId: newNotificationId(now),
      userId,
      caseId,
      kind: 'POINTS_EARNED',
      title,
      body,
      read: false,
      createdAt: isoNow(now),
      expiresAt: unixSeconds(addDays(now, 60)),
    });
  }
}
