import type { CaseRecord, CitizenLevel, CitizenLevelId, PointReason } from '../domain/types.js';

/**
 * Civic Points rules.
 *
 * Deliberately small and deterministic. Two design constraints shaped it:
 *
 *  1. **Reward outcomes, not volume.** Filing a report is worth something, but
 *     the large award is for a case that actually gets resolved. Points cannot
 *     be farmed by filing many thin reports.
 *  2. **Every award is calculated here, on the server.** Nothing about points
 *     is ever read from a request body.
 */

export const POINT_VALUES: Record<PointReason, number> = {
  /** Filing a genuine, tracked report. */
  REPORT_CREATED: 50,
  /** The complaint had no placeholders left — it was actually submittable. */
  COMPLETE_INFORMATION: 10,
  /** A photo or document was attached and verified to exist. */
  EVIDENCE_PROVIDED: 10,
  /** The underlying problem was fixed. The outcome we actually want. */
  CASE_RESOLVED: 100,
  /** Spending, not earning. The value is per-reward. */
  REWARD_REDEEMED: 0,
};

export const POINT_LABELS: Record<PointReason, string> = {
  REPORT_CREATED: 'Reported a civic issue',
  COMPLETE_INFORMATION: 'Completed every required detail',
  EVIDENCE_PROVIDED: 'Added useful evidence',
  CASE_RESOLVED: 'Problem resolved',
  REWARD_REDEEMED: 'Redeemed a reward',
};

/**
 * Citizen levels.
 *
 * Driven by *lifetime* points, not the spendable balance, so redeeming a reward
 * never demotes someone who earned the level.
 */
export const LEVELS: CitizenLevel[] = [
  {
    id: 'BRONZE',
    label: 'Bronze Citizen',
    minPoints: 0,
    blurb: 'You have started reporting what needs fixing.',
  },
  {
    id: 'SILVER',
    label: 'Silver Citizen',
    minPoints: 250,
    blurb: 'You follow your reports through, not just file them.',
  },
  {
    id: 'GOLD',
    label: 'Gold Citizen',
    minPoints: 750,
    blurb: 'Your persistence is measurably improving your area.',
  },
  {
    id: 'CHAMPION',
    label: 'Community Champion',
    minPoints: 2000,
    blurb: 'You are one of the people this city runs on.',
  },
];

export interface LevelProgress {
  level: CitizenLevel;
  next?: CitizenLevel;
  /** Points still needed for the next level; 0 at the top. */
  pointsToNext: number;
  /** 0–1 progress through the current level. 1 at the top. */
  progress: number;
}

export function levelFor(lifetimePoints: number): CitizenLevel {
  let current = LEVELS[0]!;
  for (const level of LEVELS) {
    if (lifetimePoints >= level.minPoints) current = level;
  }
  return current;
}

export function levelProgress(lifetimePoints: number): LevelProgress {
  const points = Math.max(0, lifetimePoints);
  const level = levelFor(points);
  const next = LEVELS.find((candidate) => candidate.minPoints > level.minPoints);

  if (!next) return { level, pointsToNext: 0, progress: 1 };

  const span = next.minPoints - level.minPoints;
  const earned = points - level.minPoints;
  return {
    level,
    next,
    pointsToNext: Math.max(0, next.minPoints - points),
    progress: span > 0 ? Math.min(1, earned / span) : 1,
  };
}

export function levelById(id: CitizenLevelId): CitizenLevel {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0]!;
}

/** Whether `have` meets a reward's minimum level requirement. */
export function meetsLevel(have: CitizenLevelId, required: CitizenLevelId | undefined): boolean {
  if (!required) return true;
  const rank = (id: CitizenLevelId) => LEVELS.findIndex((level) => level.id === id);
  return rank(have) >= rank(required);
}

/**
 * Whether a newly created case earned the completeness bonus.
 *
 * Derived from the case itself rather than trusted from the client: a complaint
 * with no remaining placeholders is one an authority could actually act on.
 */
export function earnsCompletenessBonus(record: Pick<CaseRecord, 'complaint' | 'location'>): boolean {
  const hasLocation = Boolean(record.location.locality || record.location.city);
  return record.complaint.placeholders.length === 0 && hasLocation;
}

/** Stable dedupe key: a reason can be earned at most once per case. */
export function awardKey(reason: PointReason, caseId: string): string {
  return `${reason}#${caseId}`;
}
