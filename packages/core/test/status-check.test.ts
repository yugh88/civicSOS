import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { StatusCheckService } from '../src/services/status-check-service.js';
import {
  applyStatusCheck,
  MIN_CHECK_INTERVAL_HOURS,
  shouldCheckStatus,
  statusCheckTargetFor,
} from '../src/rules/status-check.js';
import { classifyStatusText, getStatusCheckTarget, STATUS_CHECK_TARGETS } from '../src/status-check/targets.js';
import type { CaseRecord, StatusCheckResult } from '../src/domain/types.js';

const ALICE = 'citizen-alice';

function caseBody() {
  return {
    description: 'The sewer outside our block has been overflowing onto the street for three days.',
    categoryId: 'WATER_SEWERAGE',
    location: { locality: 'Anand Nagar', city: 'Ahmedabad' },
    facts: {
      reporterName: 'Alice',
      reporterContact: 'alice@example.invalid',
      sinceWhen: 'three days',
      householdsAffected: '15 flats',
    },
  };
}

/** A minimal record shaped for the pure eligibility rule. */
function eligible(overrides: Partial<CaseRecord> = {}): Parameters<typeof shouldCheckStatus>[0] {
  return {
    status: 'SUBMITTED',
    submittedAt: '2026-03-01T00:00:00.000Z',
    officialReference: 'SWM/2026/118472',
    submissionMode: 'MANUAL',
    categoryId: 'GARBAGE_SANITATION',
    isDemo: true,
    lastStatusCheckAt: undefined,
    ...overrides,
  };
}

describe('the status-check registry ships no invented government data', () => {
  it('contains only the practice portal', () => {
    // The whole honesty policy of this feature in one assertion: a real target
    // may only appear after someone has actually opened that page.
    const real = STATUS_CHECK_TARGETS.filter((target) => !target.practice);
    expect(real).toEqual([]);
  });

  it('marks the practice target as practice, so it can never read as official', () => {
    expect(getStatusCheckTarget('CIVICSOS_PRACTICE')?.practice).toBe(true);
    expect(getStatusCheckTarget('CIVICSOS_PRACTICE')?.label).toMatch(/not a government site/i);
  });
});

describe('reading a status page', () => {
  const target = getStatusCheckTarget('CIVICSOS_PRACTICE')!;

  it('maps the portal\'s own vocabulary to an outcome', () => {
    expect(classifyStatusText(target, 'Status: Resolved')).toBe('RESOLVED');
    expect(classifyStatusText(target, 'Status: In progress')).toBe('IN_PROGRESS');
    expect(classifyStatusText(target, 'No such complaint')).toBe('NOT_FOUND');
  });

  it('never reads a negated sentence as resolved', () => {
    // "has not been resolved" contains "resolved". A substring match alone
    // would tell a citizen their problem was fixed when the page said the
    // opposite, which is the worst failure this feature could have.
    expect(classifyStatusText(target, 'Your complaint has not been resolved.')).not.toBe('RESOLVED');
    expect(classifyStatusText(target, 'This is yet to be resolved.')).not.toBe('RESOLVED');
  });

  it('treats an unrecognised page as unreadable, never as progress', () => {
    expect(classifyStatusText(target, 'Welcome to the portal')).toBe('UNREADABLE');
    expect(classifyStatusText(target, '   ')).toBe('UNREADABLE');
  });
});

describe('deciding what is worth checking', () => {
  const now = new Date('2026-03-10T00:00:00.000Z');

  it('checks a submitted case that has a real reference', () => {
    expect(shouldCheckStatus(eligible(), now)).toBe(true);
  });

  it('skips a case that was never submitted', () => {
    expect(shouldCheckStatus(eligible({ submittedAt: undefined }), now)).toBe(false);
  });

  it('skips a case with no reference to look up', () => {
    expect(shouldCheckStatus(eligible({ officialReference: undefined }), now)).toBe(false);
  });

  it('skips a finished case', () => {
    expect(shouldCheckStatus(eligible({ status: 'RESOLVED' }), now)).toBe(false);
    expect(shouldCheckStatus(eligible({ status: 'CLOSED_UNRESOLVED' }), now)).toBe(false);
  });

  it('never looks up a simulated reference on a real portal', () => {
    // A CS-DEMO- reference exists only inside CivicSOS. Searching for it on a
    // government site would be nonsense at best and noise at worst.
    expect(shouldCheckStatus(eligible({ submissionMode: 'SIMULATED', isDemo: false }), now)).toBe(false);
  });

  it('respects the minimum interval between checks', () => {
    const justChecked = eligible({
      lastStatusCheckAt: new Date(now.getTime() - (MIN_CHECK_INTERVAL_HOURS - 1) * 3_600_000).toISOString(),
    });
    expect(shouldCheckStatus(justChecked, now)).toBe(false);

    const longEnough = eligible({
      lastStatusCheckAt: new Date(now.getTime() - (MIN_CHECK_INTERVAL_HOURS + 1) * 3_600_000).toISOString(),
    });
    expect(shouldCheckStatus(longEnough, now)).toBe(true);
  });

  it('has no target for a real authority, so real cases are never scheduled', () => {
    // Today every real authority lacks a verified status page. That must read
    // as "not scheduled", not as an error and not as a guess.
    expect(statusCheckTargetFor({ categoryId: 'GARBAGE_SANITATION', isDemo: false })).toBeUndefined();
  });
});

describe('applying what the worker saw', () => {
  let harness: TestHarness;
  let service: StatusCheckService;
  let caseId: string;

  beforeEach(async () => {
    harness = createHarness();
    service = new StatusCheckService(harness.ctx);
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, {
      user: ALICE,
      body: { officialReference: 'SWM/2026/118472' },
    });
  });

  function result(overrides: Partial<StatusCheckResult> = {}): StatusCheckResult {
    return {
      caseId,
      targetId: 'CIVICSOS_PRACTICE',
      outcome: 'IN_PROGRESS',
      checkedAt: '2026-03-10T00:00:00.000Z',
      ...overrides,
    };
  }

  it('moves a submitted case to awaiting response when the portal shows it open', async () => {
    const applied = await service.applyResult(result({ outcome: 'IN_PROGRESS' }));
    expect(applied.applied).toBe(true);

    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.status).toBe('AWAITING_RESPONSE');
    expect(detail.json.case.lastStatusCheckOutcome).toBe('IN_PROGRESS');
  });

  it('never closes a case just because the portal says closed', async () => {
    // The portal knows whether a ticket was closed. Only the citizen knows
    // whether the rubbish is actually gone. Those are different claims.
    await service.applyResult(result({ outcome: 'RESOLVED', observedLabel: 'Resolved' }));

    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.status).not.toBe('RESOLVED');
    expect(detail.json.case.resolvedAt).toBeUndefined();

    // But the citizen is told, and told why it matters either way.
    const me = await harness.call('GET', '/me', { user: ALICE });
    const notification = me.json.notifications.find((item: { kind: string }) => item.kind === 'NEEDS_ATTENTION');
    expect(notification?.title).toMatch(/closed/i);
  });

  it('records a refusal as a refusal, not as a failure', async () => {
    await service.applyResult(result({ outcome: 'NEEDS_HUMAN' }));

    const timeline = await harness.call('GET', `/cases/${caseId}/timeline`, { user: ALICE });
    const entry = timeline.json.timeline.find((event: { type: string }) => event.type === 'STATUS_CHECKED');
    expect(entry.message).toMatch(/sign-in or a CAPTCHA/i);
    expect(entry.actor).toBe('agent');

    const me = await harness.call('GET', '/me', { user: ALICE });
    const notification = me.json.notifications.find((item: { kind: string }) => item.kind === 'NEEDS_ATTENTION');
    expect(notification?.body).toMatch(/never handles either/i);
  });

  it('stays quiet when it simply could not read the page', async () => {
    const before = await harness.call('GET', '/me', { user: ALICE });
    const countBefore = before.json.notifications.length;

    await service.applyResult(result({ outcome: 'UNREADABLE' }));

    // Our scraper failing is our problem. Waking the citizen nightly about it
    // would train them to ignore the notifications that do matter.
    const after = await harness.call('GET', '/me', { user: ALICE });
    expect(after.json.notifications.length).toBe(countBefore);

    // It is still recorded, so "nobody checked" and "nothing changed" stay
    // distinguishable.
    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.lastStatusCheckOutcome).toBe('UNREADABLE');
  });

  it('refuses a result for a target that is not in the registry', async () => {
    // The worker is trusted, but a result naming an unknown page is not a
    // result we asked for.
    const applied = await service.applyResult(result({ targetId: 'SOME_OTHER_SITE' }));
    expect(applied.applied).toBe(false);
    expect(applied.reason).toBe('unknown-target');
  });

  it('attributes the notification to the case owner, not to whoever the result names', async () => {
    // The owner comes from the stored record, so a malformed result cannot
    // drop one citizen's case into another citizen's notification list.
    await service.applyResult(result({ outcome: 'RESOLVED' }));

    const bob = await harness.call('GET', '/me', { user: 'citizen-bob' });
    expect(bob.json.notifications.filter((n: { caseId?: string }) => n.caseId === caseId)).toEqual([]);
  });

  it('does not apply a result for a case that no longer exists', async () => {
    const applied = await service.applyResult(result({ caseId: 'case_does_not_exist' }));
    expect(applied.applied).toBe(false);
    expect(applied.reason).toBe('case-not-found');
  });
});

describe('the pure application rule', () => {
  const record = {
    caseId: 'case_1',
    ownerId: ALICE,
    status: 'SUBMITTED',
    officialReference: 'SWM/2026/118472',
    updatedAt: '2026-03-01T00:00:00.000Z',
  } as CaseRecord;

  const now = new Date('2026-03-10T00:00:00.000Z');

  it('always records that a check happened, whatever the outcome', () => {
    for (const outcome of ['RESOLVED', 'IN_PROGRESS', 'NOT_FOUND', 'NEEDS_HUMAN', 'UNREADABLE'] as const) {
      const application = applyStatusCheck(
        record,
        { caseId: record.caseId, targetId: 'CIVICSOS_PRACTICE', outcome, checkedAt: now.toISOString() },
        now,
      );
      expect(application.record.lastStatusCheckAt).toBe(now.toISOString());
      expect(application.record.lastStatusCheckOutcome).toBe(outcome);
      expect(application.eventMessage.length).toBeGreaterThan(0);
    }
  });

  it('names the practice portal as a practice portal in what the citizen reads', () => {
    const application = applyStatusCheck(
      record,
      { caseId: record.caseId, targetId: 'CIVICSOS_PRACTICE', outcome: 'IN_PROGRESS', checkedAt: now.toISOString() },
      now,
    );
    expect(application.eventMessage).toMatch(/not a government site/i);
  });
});
