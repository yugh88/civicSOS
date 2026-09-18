import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { levelFor, levelProgress, meetsLevel, POINT_VALUES } from '../src/rules/points.js';
import { REWARDS } from '../src/knowledge/rewards.js';

/**
 * Civic Points and rewards.
 *
 * The properties worth testing are the anti-abuse ones: awards are idempotent,
 * amounts are server-calculated, and a client cannot write its own balance.
 */

const ALICE = 'citizen-alice';
const BOB = 'citizen-bob';

function caseBody(overrides: Record<string, unknown> = {}) {
  return {
    description: 'There has been garbage outside my apartment for 4 days and it now smells terrible.',
    categoryId: 'GARBAGE_SANITATION',
    location: { locality: '12th Main, Indiranagar', city: 'Bengaluru' },
    facts: { sinceWhen: 'for 4 days', reporterName: 'Alice', reporterContact: 'alice@example.invalid' },
    ...overrides,
  };
}

describe('citizen levels', () => {
  it('maps lifetime points to the right level', () => {
    expect(levelFor(0).id).toBe('BRONZE');
    expect(levelFor(249).id).toBe('BRONZE');
    expect(levelFor(250).id).toBe('SILVER');
    expect(levelFor(750).id).toBe('GOLD');
    expect(levelFor(5000).id).toBe('CHAMPION');
  });

  it('reports progress toward the next level', () => {
    const progress = levelProgress(170);
    expect(progress.level.id).toBe('BRONZE');
    expect(progress.next?.id).toBe('SILVER');
    expect(progress.pointsToNext).toBe(80);
    expect(progress.progress).toBeCloseTo(170 / 250, 3);
  });

  it('caps out at the top level', () => {
    const progress = levelProgress(9999);
    expect(progress.next).toBeUndefined();
    expect(progress.pointsToNext).toBe(0);
    expect(progress.progress).toBe(1);
  });

  it('never reports negative progress for a nonsense balance', () => {
    expect(levelProgress(-500).progress).toBe(0);
  });

  it('gates rewards by level', () => {
    expect(meetsLevel('BRONZE', 'SILVER')).toBe(false);
    expect(meetsLevel('GOLD', 'SILVER')).toBe(true);
    expect(meetsLevel('BRONZE', undefined)).toBe(true);
  });
});

describe('earning points', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('awards the report and completeness bonuses on a complete first report', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    expect(created.status).toBe(201);
    expect(created.json.pointsAwarded).toBe(POINT_VALUES.REPORT_CREATED + POINT_VALUES.COMPLETE_INFORMATION);

    const me = await harness.call('GET', '/me', { user: ALICE });
    expect(me.json.profile.civicPoints).toBe(60);
    expect(me.json.profile.lifetimePoints).toBe(60);
    expect(me.json.impact.casesReported).toBe(1);
  });

  it('withholds the completeness bonus when the complaint still has blanks', async () => {
    const created = await harness.call('POST', '/cases', {
      user: ALICE,
      // No reporter name or contact, so placeholders remain.
      body: caseBody({ facts: { sinceWhen: 'for 4 days' } }),
    });
    expect(created.json.pointsAwarded).toBe(POINT_VALUES.REPORT_CREATED);
  });

  it('does not award twice for a replayed creation', async () => {
    const body = caseBody({ idempotencyKey: 'repeat-key-001' });
    const first = await harness.call('POST', '/cases', { user: ALICE, body });
    const second = await harness.call('POST', '/cases', { user: ALICE, body });

    expect(first.json.pointsAwarded).toBe(60);
    // The replay creates no case, so it awards nothing.
    expect(second.json.created).toBe(false);
    expect(second.json.pointsAwarded).toBe(0);

    const me = await harness.call('GET', '/me', { user: ALICE });
    expect(me.json.profile.civicPoints).toBe(60);
  });

  it('awards the evidence bonus once, however many files are attached', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;

    for (const name of ['a.jpg', 'b.jpg']) {
      const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
        user: ALICE,
        body: { fileName: name, contentType: 'image/jpeg', sizeBytes: 1000 },
      });
      await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
        user: ALICE,
        body: { evidenceId: reserved.json.evidenceId },
      });
    }

    const me = await harness.call('GET', '/me', { user: ALICE });
    expect(me.json.profile.civicPoints).toBe(60 + POINT_VALUES.EVIDENCE_PROVIDED);
  });

  it('awards the large bonus only for a genuine resolution', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: ALICE, body: {} });

    const resolved = await harness.call('POST', `/cases/${caseId}/resolve`, {
      user: ALICE,
      body: { outcome: 'FIXED' },
    });
    expect(resolved.json.pointsAwarded).toBe(POINT_VALUES.CASE_RESOLVED);

    const me = await harness.call('GET', '/me', { user: ALICE });
    expect(me.json.profile.civicPoints).toBe(160);
    expect(me.json.impact.casesResolved).toBe(1);
    expect(me.json.notifications.some((entry: any) => entry.kind === 'POINTS_EARNED')).toBe(true);
  });

  it('awards nothing for closing a case without a fix', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: ALICE, body: {} });

    const closed = await harness.call('POST', `/cases/${caseId}/resolve`, {
      user: ALICE,
      body: { outcome: 'CLOSED_WITHOUT_FIX' },
    });
    expect(closed.json.pointsAwarded).toBe(0);

    const me = await harness.call('GET', '/me', { user: ALICE });
    expect(me.json.profile.civicPoints).toBe(60);
  });

  it('keeps each citizen’s points separate', async () => {
    await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const bob = await harness.call('GET', '/me', { user: BOB });
    expect(bob.json.profile.civicPoints).toBe(0);
  });

  it('records a readable ledger entry for every award', async () => {
    await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const me = await harness.call('GET', '/me', { user: ALICE });
    const reasons = me.json.pointsHistory.map((entry: any) => entry.reason);
    expect(reasons).toContain('REPORT_CREATED');
    expect(reasons).toContain('COMPLETE_INFORMATION');
    expect(me.json.pointsHistory.every((entry: any) => typeof entry.label === 'string')).toBe(true);
  });

  it('ignores points sent in a profile update', async () => {
    await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const updated = await harness.call('PATCH', '/me', {
      user: ALICE,
      body: { displayName: 'Alice', civicPoints: 999999, lifetimePoints: 999999, casesResolved: 500 },
    });
    expect(updated.json.profile.civicPoints).toBe(60);
    expect(updated.json.profile.lifetimePoints).toBe(60);
    expect(updated.json.profile.casesResolved).toBe(0);
  });
});

describe('rewards', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('labels every shipped reward as a demo catalogue entry', () => {
    // The project has no confirmed sponsors, so nothing may claim otherwise.
    expect(REWARDS.every((reward) => reward.isSampleCatalog)).toBe(true);
  });

  it('shows the balance, level and what is affordable', async () => {
    const result = await harness.call('GET', '/rewards', { user: ALICE });
    expect(result.status).toBe(200);
    expect(result.json.balance).toBe(0);
    expect(result.json.level.level.id).toBe('BRONZE');
    expect(result.json.isSampleCatalog).toBe(true);
    expect(result.json.disclaimer).toMatch(/no confirmed sponsors/);
    expect(result.json.rewards.every((reward: any) => reward.affordable === false)).toBe(true);
    expect(result.json.rewards[0].lockedReason).toMatch(/more points needed/);
  });

  it('refuses a redemption the citizen cannot afford', async () => {
    const result = await harness.call('POST', '/rewards/voucher-local-cafe/redeem', { user: ALICE, body: {} });
    expect(result.status).toBe(409);
    expect(result.json.error.message).toMatch(/more Civic Points/);
  });

  it('refuses a level-gated reward even when affordable', async () => {
    // Enough points for the walk, but still a Bronze citizen.
    await harness.ctx.repository.bumpUserCounters(ALICE, { civicPoints: 900, lifetimePoints: 100 });
    const result = await harness.call('POST', '/rewards/experience-heritage-walk/redeem', {
      user: ALICE,
      body: {},
    });
    expect(result.status).toBe(403);
  });

  it('redeems, debits the balance and issues a clearly-marked demo code', async () => {
    await harness.ctx.repository.bumpUserCounters(ALICE, { civicPoints: 300, lifetimePoints: 300 });

    const result = await harness.call('POST', '/rewards/voucher-local-cafe/redeem', { user: ALICE, body: {} });
    expect(result.status).toBe(201);
    expect(result.json.balance).toBe(150);
    expect(result.json.redemption.code).toMatch(/^DEMO-/);

    const overview = await harness.call('GET', '/rewards', { user: ALICE });
    expect(overview.json.balance).toBe(150);
    expect(overview.json.redemptions).toHaveLength(1);
  });

  it('never demotes a citizen for spending points', async () => {
    await harness.ctx.repository.bumpUserCounters(ALICE, { civicPoints: 300, lifetimePoints: 300 });
    await harness.call('POST', '/rewards/voucher-local-cafe/redeem', { user: ALICE, body: {} });

    const me = await harness.call('GET', '/me', { user: ALICE });
    // Spendable balance fell; lifetime total, which drives the level, did not.
    expect(me.json.profile.civicPoints).toBe(150);
    expect(me.json.profile.lifetimePoints).toBe(300);
    expect(me.json.level.level.id).toBe('SILVER');
  });

  it('rejects an unknown reward id', async () => {
    expect((await harness.call('POST', '/rewards/not-a-reward/redeem', { user: ALICE, body: {} })).status).toBe(404);
  });

  it('requires a session', async () => {
    expect((await harness.call('GET', '/rewards')).status).toBe(401);
    expect((await harness.call('POST', '/rewards/voucher-local-cafe/redeem', { body: {} })).status).toBe(401);
  });
});

describe('demo session seeding', () => {
  it('gives a guest notifications, a points ledger and a balance that agree', async () => {
    const harness = createHarness();
    const guest = await harness.call('POST', '/auth/guest', { body: {} });
    const token = guest.json.token;

    const me = await harness.call('GET', '/me', { token });
    expect(me.json.profile.civicPoints).toBeGreaterThan(0);
    expect(me.json.notifications.length).toBeGreaterThan(0);
    expect(me.json.unreadCount).toBeGreaterThan(0);
    expect(me.json.pointsHistory.length).toBeGreaterThan(0);

    // Every seeded notification must point at a case the guest can actually
    // open — a notification linking nowhere is worse than none at all.
    const cases = await harness.call('GET', '/cases', { token });
    const owned = new Set(cases.json.cases.map((record: any) => record.caseId));
    for (const notification of me.json.notifications) {
      expect(owned.has(notification.caseId), notification.caseId).toBe(true);
    }

    // And the ledger entries must reference real cases too, so the per-case
    // points shown on the case list line up.
    for (const entry of me.json.pointsHistory) {
      if (entry.caseId) expect(owned.has(entry.caseId), entry.caseId).toBe(true);
    }
  });
});
