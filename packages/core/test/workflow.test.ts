import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { assessEscalation, computeFollowUpDate } from '../src/rules/followup.js';
import { canTransition } from '../src/rules/status.js';
import { buildComplaintDraft, remainingPlaceholders } from '../src/rules/complaint.js';
import { buildResolutionPlan } from '../src/rules/resolution.js';

/**
 * End-to-end coverage of the core journey, exercised through the real HTTP
 * router so routing, validation, authorization and the services are all in play.
 */

const CITIZEN = 'citizen-alice';

function createCaseBody(overrides: Record<string, unknown> = {}) {
  return {
    description: 'There has been garbage outside my apartment for 4 days and it now smells terrible.',
    categoryId: 'GARBAGE_SANITATION',
    location: { locality: '12th Main, Indiranagar', city: 'Bengaluru', state: 'Karnataka' },
    facts: { sinceWhen: 'for 4 days', reporterName: 'Alice', reporterContact: 'alice@example.invalid' },
    ...overrides,
  };
}

describe('the full citizen journey', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('walks describe -> analyze -> create -> submit -> follow up -> escalate -> resolve', async () => {
    // 3. Analyze
    const analyzed = await harness.call('POST', '/cases/analyze', {
      user: CITIZEN,
      body: {
        description: 'There has been garbage outside my apartment for 4 days and it now smells terrible.',
        location: { locality: '12th Main, Indiranagar', city: 'Bengaluru' },
      },
    });
    expect(analyzed.status).toBe(200);
    expect(analyzed.json.analysis.categoryId).toBe('GARBAGE_SANITATION');
    expect(analyzed.json.analysis.plan.steps[0].status).toBe('DONE');
    expect(analyzed.json.analysis.plan.disclaimer).toContain('does not file complaints on your behalf');

    // 11. Create the case
    const created = await harness.call('POST', '/cases', { user: CITIZEN, body: createCaseBody() });
    expect(created.status).toBe(201);
    const caseId = created.json.case.caseId;
    expect(created.json.case.status).toBe('READY_TO_SUBMIT');
    expect(created.json.case.followUpAt).toBeTruthy();
    expect(harness.events.published.map((event) => event.type)).toContain('CaseCreated');

    // 12. It appears in the dashboard
    const listed = await harness.call('GET', '/cases', { user: CITIZEN });
    expect(listed.json.cases).toHaveLength(1);

    // 13. Detail view carries the plan and the timeline
    const detail = await harness.call('GET', `/cases/${caseId}`, { user: CITIZEN });
    expect(detail.status).toBe(200);
    expect(detail.json.timeline[0].type).toBe('CASE_CREATED');
    expect(detail.json.plan.evidence.some((item: any) => item.key === 'location' && item.satisfied)).toBe(true);

    // 10-11. Record the official submission
    const submitted = await harness.call('POST', `/cases/${caseId}/submitted`, {
      user: CITIZEN,
      body: { officialReference: 'SWM-12345', channel: 'Swachhata app' },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.json.case.status).toBe('SUBMITTED');
    expect(submitted.json.case.submittedAt).toBeTruthy();

    // 14. Follow up
    const followedUp = await harness.call('POST', `/cases/${caseId}/follow-up`, {
      user: CITIZEN,
      body: { note: 'Called the helpline, told it is in process.' },
    });
    expect(followedUp.status).toBe(200);
    expect(followedUp.json.case.status).toBe('AWAITING_RESPONSE');

    // 16. Escalation is refused before the waiting window elapses
    const tooEarly = await harness.call('POST', `/cases/${caseId}/follow-up`, {
      user: CITIZEN,
      body: { escalate: true },
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.json.error.message).toMatch(/becomes appropriate/);

    // ...and allowed once it has
    harness.clock.advanceDays(10);
    const escalated = await harness.call('POST', `/cases/${caseId}/follow-up`, {
      user: CITIZEN,
      body: { escalate: true },
    });
    expect(escalated.status).toBe(200);
    expect(escalated.json.case.status).toBe('ESCALATED');
    expect(escalated.json.case.escalationLevel).toBe(1);

    // 17. Resolve
    const resolved = await harness.call('POST', `/cases/${caseId}/resolve`, {
      user: CITIZEN,
      body: { outcome: 'FIXED', resolutionNote: 'Cleared and collection restarted.' },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.json.case.status).toBe('RESOLVED');
    // A resolved case must not keep a follow-up date, or reminders would fire.
    expect(resolved.json.case.followUpAt).toBeUndefined();

    // 18. Full history remains visible
    const timeline = await harness.call('GET', `/cases/${caseId}/timeline`, { user: CITIZEN });
    const types = timeline.json.timeline.map((event: any) => event.type);
    expect(types).toEqual([
      'CASE_CREATED',
      'MARKED_SUBMITTED',
      'FOLLOW_UP_LOGGED',
      'ESCALATED',
      'RESOLVED',
    ]);
  });

  it('is idempotent on case creation', async () => {
    const body = createCaseBody({ idempotencyKey: 'key-abc-123' });
    const first = await harness.call('POST', '/cases', { user: CITIZEN, body });
    const second = await harness.call('POST', '/cases', { user: CITIZEN, body });
    expect(first.json.case.caseId).toBe(second.json.case.caseId);
    expect(second.json.created).toBe(false);
    const listed = await harness.call('GET', '/cases', { user: CITIZEN });
    expect(listed.json.cases).toHaveLength(1);
  });

  it('starts a case as DRAFT while the complaint still has placeholders', async () => {
    const created = await harness.call('POST', '/cases', {
      user: CITIZEN,
      // No reporter name/contact, so the template keeps its placeholders.
      body: createCaseBody({ facts: { sinceWhen: 'for 4 days' } }),
    });
    expect(created.json.case.status).toBe('DRAFT');
    expect(created.json.case.complaint.placeholders).toContain('YOUR_NAME');
  });

  it('promotes a draft to ready once the citizen fills the placeholders in', async () => {
    const created = await harness.call('POST', '/cases', {
      user: CITIZEN,
      body: createCaseBody({ facts: { sinceWhen: 'for 4 days' } }),
    });
    const caseId = created.json.case.caseId;
    const filled = created.json.case.complaint.body
      .replace('[[YOUR_NAME]]', 'Alice Fernandes')
      .replace('[[YOUR_CONTACT]]', 'alice@example.invalid');

    const updated = await harness.call('PATCH', `/cases/${caseId}`, {
      user: CITIZEN,
      body: { complaint: { body: filled } },
    });
    expect(updated.json.case.status).toBe('READY_TO_SUBMIT');
    expect(updated.json.case.complaint.placeholders).toEqual([]);
    expect(updated.json.case.complaint.editedByUser).toBe(true);
  });

  it('refuses a follow-up before the case has been submitted', async () => {
    const created = await harness.call('POST', '/cases', { user: CITIZEN, body: createCaseBody() });
    const result = await harness.call('POST', `/cases/${created.json.case.caseId}/follow-up`, {
      user: CITIZEN,
      body: {},
    });
    expect(result.status).toBe(409);
    expect(result.json.error.message).toMatch(/submitted first/);
  });

  it('refuses to reopen a resolved case', async () => {
    const created = await harness.call('POST', '/cases', { user: CITIZEN, body: createCaseBody() });
    const caseId = created.json.case.caseId;
    await harness.call('POST', `/cases/${caseId}/submitted`, { user: CITIZEN, body: {} });
    await harness.call('POST', `/cases/${caseId}/resolve`, { user: CITIZEN, body: { outcome: 'FIXED' } });

    const reopened = await harness.call('PATCH', `/cases/${caseId}`, {
      user: CITIZEN,
      body: { status: 'SUBMITTED' },
    });
    expect(reopened.status).toBe(409);
  });

  it('recomputes authority and timings when the category is corrected', async () => {
    const created = await harness.call('POST', '/cases', { user: CITIZEN, body: createCaseBody() });
    const caseId = created.json.case.caseId;
    expect(created.json.case.authorityId).toBe('MUNICIPAL_SANITATION');

    const updated = await harness.call('PATCH', `/cases/${caseId}`, {
      user: CITIZEN,
      body: { categoryId: 'ROAD_DAMAGE' },
    });
    expect(updated.json.case.authorityId).toBe('MUNICIPAL_ROADS');
    expect(updated.json.case.pathId).toBe('PATH_ROAD_DAMAGE_V1');
  });

  it('ignores a client-supplied urgency for a citizen', async () => {
    const created = await harness.call('POST', '/cases', {
      user: CITIZEN,
      body: createCaseBody({ urgency: 'CRITICAL' }),
    });
    // Derived from the text, which describes ordinary uncollected waste.
    expect(created.json.case.urgency).toBe('MEDIUM');
  });
});

describe('status machine', () => {
  it('allows only sensible transitions', () => {
    expect(canTransition('DRAFT', 'READY_TO_SUBMIT')).toBe(true);
    expect(canTransition('SUBMITTED', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'DRAFT')).toBe(false);
    expect(canTransition('RESOLVED', 'SUBMITTED')).toBe(false);
    expect(canTransition('DRAFT', 'ESCALATED')).toBe(false);
  });
});

describe('follow-up and escalation rules', () => {
  const base = {
    categoryId: 'GARBAGE_SANITATION' as const,
    urgency: 'MEDIUM' as const,
    createdAt: '2026-03-01T00:00:00.000Z',
    escalationLevel: 0,
  };

  it('measures the follow-up date from submission when available', () => {
    const fromCreation = computeFollowUpDate(base);
    const fromSubmission = computeFollowUpDate({ ...base, submittedAt: '2026-03-05T00:00:00.000Z' });
    expect(new Date(fromSubmission).getTime()).toBeGreaterThan(new Date(fromCreation).getTime());
  });

  it('chases urgent cases sooner', () => {
    const medium = computeFollowUpDate(base);
    const critical = computeFollowUpDate({ ...base, urgency: 'CRITICAL' });
    expect(new Date(critical).getTime()).toBeLessThanOrEqual(new Date(medium).getTime());
  });

  it('unlocks escalation steps only as the waiting windows elapse', () => {
    const submitted = {
      ...base,
      status: 'SUBMITTED' as const,
      submittedAt: '2026-03-01T00:00:00.000Z',
      followUpAt: '2026-03-02T00:00:00.000Z',
    };
    expect(assessEscalation(submitted, new Date('2026-03-03T00:00:00.000Z')).availableLevel).toBe(0);
    expect(assessEscalation(submitted, new Date('2026-03-09T00:00:00.000Z')).availableLevel).toBe(1);
    expect(assessEscalation(submitted, new Date('2026-03-16T00:00:00.000Z')).availableLevel).toBe(2);
    expect(assessEscalation(submitted, new Date('2026-04-05T00:00:00.000Z')).availableLevel).toBe(3);
  });

  it('never offers escalation on a closed case', () => {
    const resolved = { ...base, status: 'RESOLVED' as const, submittedAt: '2026-01-01T00:00:00.000Z' };
    const assessment = assessEscalation(resolved, new Date('2026-06-01T00:00:00.000Z'));
    expect(assessment.availableLevel).toBe(0);
    expect(assessment.reason).toMatch(/closed/);
  });

  it('never offers escalation before submission', () => {
    const draft = { ...base, status: 'DRAFT' as const };
    expect(assessEscalation(draft, new Date('2026-06-01T00:00:00.000Z')).availableLevel).toBe(0);
  });
});

describe('complaint drafting', () => {
  it('leaves unknown values as visible placeholders instead of inventing them', () => {
    const draft = buildComplaintDraft({
      categoryId: 'ROAD_DAMAGE',
      description: 'Large pothole at the junction.',
      location: {},
    });
    expect(draft.placeholders).toContain('LOCATION');
    expect(draft.placeholders).toContain('YOUR_NAME');
    expect(draft.body).toContain('[[LOCATION]]');
  });

  it('fills in everything it has been given', () => {
    const draft = buildComplaintDraft({
      categoryId: 'ROAD_DAMAGE',
      description: 'Large pothole at the junction.',
      location: { locality: 'Kothrud junction', city: 'Pune' },
      sinceWhen: 'for two weeks',
      reporterName: 'Rahul',
      reporterContact: 'rahul@example.invalid',
    });
    expect(draft.placeholders).toEqual([]);
    expect(draft.body).toContain('Kothrud junction, Pune');
    expect(draft.body).toContain('for two weeks');
    expect(draft.body).toContain('Rahul');
  });

  it('never claims the complaint has been filed for the citizen', () => {
    const draft = buildComplaintDraft({
      categoryId: 'GARBAGE_SANITATION',
      description: 'Garbage everywhere.',
      location: { city: 'Pune' },
    });
    expect(draft.body).not.toMatch(/we have (?:filed|submitted)/i);
    expect(draft.body).toMatch(/Yours faithfully/);
  });

  it('resolves genuinely optional tokens instead of leaving a dead blank', () => {
    // The water template mentions a consumer number "where applicable". A
    // citizen without one must still be able to submit.
    const draft = buildComplaintDraft({
      categoryId: 'WATER_SEWERAGE',
      description: 'Muddy water from the tap.',
      location: { locality: 'Anand Nagar', city: 'Ahmedabad' },
      sinceWhen: 'for two days',
      reporterName: 'Alice',
      reporterContact: 'alice@example.invalid',
    });
    expect(draft.placeholders).toEqual([]);
    expect(draft.body).toContain('not applicable');
  });

  it('detects placeholders left in user-edited text', () => {
    expect(remainingPlaceholders('Hello [[YOUR_NAME]] at [[LOCATION]]')).toEqual(['LOCATION', 'YOUR_NAME']);
    expect(remainingPlaceholders('All filled in.')).toEqual([]);
  });
});

describe('resolution plan', () => {
  it('marks exactly one step as CURRENT', () => {
    const plan = buildResolutionPlan({
      categoryId: 'STREETLIGHT',
      urgency: 'MEDIUM',
      location: { city: 'Gurugram' },
      whatHappened: 'Lights out.',
    });
    expect(plan.steps.filter((step) => step.status === 'CURRENT')).toHaveLength(1);
  });

  it('never shows a completed step after a pending one', () => {
    // The timeline is only readable if progress is monotonic.
    const plan = buildResolutionPlan(
      {
        categoryId: 'GARBAGE_SANITATION',
        urgency: 'MEDIUM',
        location: { city: 'Bengaluru' },
        whatHappened: 'Garbage.',
        // Deliberately missing the photo, yet already submitted and followed up.
        hasPhoto: false,
      },
      {
        status: 'AWAITING_RESPONSE',
        createdAt: '2026-02-01T00:00:00.000Z',
        submittedAt: '2026-02-02T00:00:00.000Z',
        escalationLevel: 0,
      },
    );
    const statuses = plan.steps.map((step) => step.status);
    const firstPending = statuses.findIndex((status) => status !== 'DONE');
    expect(firstPending).toBeGreaterThan(0);
    expect(statuses.slice(firstPending)).not.toContain('DONE');
    expect(statuses.filter((status) => status === 'CURRENT')).toHaveLength(1);
    // Having submitted and followed up, the citizen is at the escalation step.
    expect(plan.steps[firstPending]!.key).toBe('escalate');
  });

  it('quotes the case\'s own follow-up date on the follow-up step', () => {
    // Regression: the step used to derive its date from the resolution window
    // while the case header used the acknowledgement window, so an overdue case
    // said "follow up was due yesterday" and "follow up in 7 days" at once.
    const plan = buildResolutionPlan(
      {
        categoryId: 'STREETLIGHT',
        urgency: 'MEDIUM',
        location: { city: 'Gurugram' },
        whatHappened: 'Lights out.',
      },
      {
        status: 'SUBMITTED',
        createdAt: '2026-09-15T00:00:00.000Z',
        submittedAt: '2026-09-16T00:00:00.000Z',
        followUpAt: '2026-09-19T00:00:00.000Z',
        escalationLevel: 0,
      },
    );

    const followUpStep = plan.steps.find((step) => step.key === 'follow_up');
    expect(followUpStep?.dueAt).toBe(plan.followUpAt);
    expect(followUpStep?.dueAt).toBe('2026-09-19T00:00:00.000Z');

    // And escalation still comes after it, never on the same day by accident.
    const escalateStep = plan.steps.find((step) => step.key === 'escalate');
    expect(escalateStep?.dueAt).toBeDefined();
    expect(new Date(escalateStep!.dueAt!).getTime()).toBeGreaterThan(
      new Date(followUpStep!.dueAt!).getTime(),
    );
  });

  it('shows no follow-up date before the complaint has been submitted', () => {
    const plan = buildResolutionPlan({
      categoryId: 'STREETLIGHT',
      urgency: 'MEDIUM',
      location: { city: 'Gurugram' },
      whatHappened: 'Lights out.',
    });
    expect(plan.steps.find((step) => step.key === 'follow_up')?.dueAt).toBeUndefined();
  });

  it('flags the required evidence that is still missing', () => {
    const plan = buildResolutionPlan({
      categoryId: 'ROAD_DAMAGE',
      urgency: 'MEDIUM',
      location: {},
      whatHappened: 'Pothole.',
    });
    const evidenceStep = plan.steps.find((step) => step.key === 'evidence');
    expect(evidenceStep?.status).toBe('CURRENT');
    expect(evidenceStep?.detail).toMatch(/Still needed/);
  });

  it('routes safety hazards to emergency services first', () => {
    const plan = buildResolutionPlan({
      categoryId: 'PUBLIC_SAFETY_HAZARD',
      urgency: 'CRITICAL',
      location: { city: 'Pune' },
      whatHappened: 'Live wire.',
    });
    expect(plan.submissionChannels[0].kind).toBe('PHONE');
    expect(plan.submissionChannels[0].value).toBe('112');
  });

  it('labels every generic authority template as sample data', () => {
    const plan = buildResolutionPlan({
      categoryId: 'WATER_SEWERAGE',
      urgency: 'HIGH',
      location: { city: 'Ahmedabad' },
      whatHappened: 'No water.',
    });
    expect(plan.authority.isSample).toBe(true);
    expect(plan.authority.sourceNote).toMatch(/[Gg]eneric template/);
  });
});
