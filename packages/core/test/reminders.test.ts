import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { ReminderService } from '../src/services/reminder-service.js';
import { seedDemoData, DEMO_OWNER_ID } from '../src/demo/seed.js';

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

describe('reminder sweep', () => {
  let harness: TestHarness;
  let reminders: ReminderService;

  beforeEach(() => {
    harness = createHarness();
    reminders = new ReminderService(harness.ctx);
  });

  it('does nothing when no case is due', async () => {
    await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const result = await reminders.sweep();
    expect(result.remindersCreated).toBe(0);
  });

  it('creates a reminder and a timeline entry once a case is overdue', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: ALICE, body: {} });

    harness.clock.advanceDays(3);
    const result = await reminders.sweep();
    expect(result.remindersCreated).toBe(1);
    expect(result.caseIds).toContain(caseId);

    const notifications = await harness.repository.listNotifications(ALICE);
    expect(notifications.some((entry) => entry.kind === 'FOLLOW_UP_DUE')).toBe(true);
    // Notifications carry a TTL so the table cannot grow without bound.
    expect(notifications[0].expiresAt).toBeGreaterThan(0);

    const timeline = await harness.call('GET', `/cases/${caseId}/timeline`, { user: ALICE });
    expect(timeline.json.timeline.some((event: any) => event.type === 'FOLLOW_UP_DUE')).toBe(true);
  });

  it('is idempotent on the same day', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    await harness.call('POST', `/cases/${created.json.case.caseId}/submitted`, { user: ALICE, body: {} });
    harness.clock.advanceDays(3);

    await reminders.sweep();
    const second = await reminders.sweep();
    expect(second.remindersCreated).toBe(0);

    const notifications = await harness.repository.listNotifications(ALICE);
    expect(notifications.filter((entry) => entry.kind === 'FOLLOW_UP_DUE')).toHaveLength(1);
  });

  it('nudges an unsubmitted case to be submitted rather than chased', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    harness.clock.advanceDays(3);

    const result = await reminders.sweep();
    expect(result.remindersCreated).toBe(1);

    const notifications = await harness.repository.listNotifications(ALICE);
    expect(notifications[0].title).toMatch(/waiting to be submitted/);
    expect(notifications[0].body).not.toMatch(/complaint number/);

    const timeline = await harness.call('GET', `/cases/${created.json.case.caseId}/timeline`, { user: ALICE });
    expect(timeline.json.timeline.some((event: any) => /not yet submitted/.test(event.message))).toBe(true);
  });

  it('suggests escalation once the waiting window has elapsed', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: ALICE, body: {} });

    harness.clock.advanceDays(9);
    const result = await reminders.sweep();
    expect(result.escalationsSuggested).toBe(1);

    const notifications = await harness.repository.listNotifications(ALICE);
    expect(notifications.some((entry) => entry.kind === 'ESCALATION_AVAILABLE')).toBe(true);
  });

  it('never reminds about a resolved case', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: ALICE, body: {} });
    await harness.call('POST', `/cases/${caseId}/resolve`, { user: ALICE, body: { outcome: 'FIXED' } });

    harness.clock.advanceDays(60);
    const result = await reminders.sweep();
    expect(result.remindersCreated).toBe(0);
  });

  it('keeps sweeping when one case fails', async () => {
    const first = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const second = await harness.call('POST', '/cases', { user: ALICE, body: { ...caseBody(), idempotencyKey: 'second-case-key' } });
    for (const created of [first, second]) {
      await harness.call('POST', `/cases/${created.json.case.caseId}/submitted`, { user: ALICE, body: {} });
    }
    harness.clock.advanceDays(5);

    // Make the first case's update fail by removing it from under the sweep.
    const originalUpdate = harness.repository.updateCase.bind(harness.repository);
    let calls = 0;
    harness.repository.updateCase = async (record) => {
      calls += 1;
      if (calls === 1) throw new Error('simulated write failure');
      return originalUpdate(record);
    };

    const result = await reminders.sweep();
    expect(result.caseIds).toHaveLength(1);
  });
});

describe('demo data', () => {
  it('seeds cases that are all clearly marked as demo', async () => {
    const harness = createHarness();
    const result = await seedDemoData(harness.repository, harness.clock.now());
    expect(result.seeded).toBeGreaterThan(3);

    const page = await harness.repository.listCasesByOwner(DEMO_OWNER_ID);
    expect(page.items.every((record) => record.isDemo)).toBe(true);
    expect(page.items.every((record) => record.classifiedBy === 'DEMO_DATA')).toBe(true);
  });

  it('is idempotent, so a dev-server restart does not duplicate cases', async () => {
    const harness = createHarness();
    await seedDemoData(harness.repository, harness.clock.now());
    await seedDemoData(harness.repository, harness.clock.now());
    const page = await harness.repository.listCasesByOwner(DEMO_OWNER_ID, { limit: 50 });
    expect(page.items).toHaveLength(4);
  });

  it('includes a case old enough for escalation to be unlocked', async () => {
    const harness = createHarness();
    await seedDemoData(harness.repository, harness.clock.now());
    const page = await harness.repository.listCasesByOwner(DEMO_OWNER_ID, { limit: 50 });
    const escalatable = page.items.find((record) => record.caseId === 'demo_garbage_overdue');
    expect(escalatable).toBeDefined();
    expect(escalatable!.status).toBe('AWAITING_RESPONSE');
    expect(escalatable!.submittedAt).toBeTruthy();
  });

  it('never gives a resolved demo case a follow-up date', async () => {
    const harness = createHarness();
    await seedDemoData(harness.repository, harness.clock.now());
    const resolved = await harness.repository.getCase('demo_pothole_resolved');
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.followUpAt).toBeUndefined();
  });
});
