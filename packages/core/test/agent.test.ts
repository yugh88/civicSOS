import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { casePhase, checkAction, demoReference, selectSubmissionChannel } from '../src/rules/agent.js';
import { REWARDS } from '../src/knowledge/rewards.js';

/**
 * The agent.
 *
 * The properties worth testing are the ones a citizen is trusting us with:
 * nothing is submitted without approval, nothing is submitted twice, and
 * nothing the agent produces can be mistaken for a real government action.
 */

const ALICE = 'citizen-alice';
const BOB = 'citizen-bob';

function completeCaseBody(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Garbage has not been collected outside my apartment for 5 days and it smells terrible.',
    categoryId: 'GARBAGE_SANITATION',
    location: { locality: '12th Main, Indiranagar', city: 'Bengaluru' },
    facts: {
      sinceWhen: 'for 5 days',
      reporterName: 'Alice Fernandes',
      reporterContact: 'alice@example.invalid',
    },
    ...overrides,
  };
}

async function createCase(harness: TestHarness, overrides: Record<string, unknown> = {}) {
  const created = await harness.call('POST', '/cases', { user: ALICE, body: completeCaseBody(overrides) });
  expect(created.status).toBe(201);
  return created.json.case.caseId as string;
}

describe('agent submission', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('refuses to submit without explicit approval', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, { user: ALICE, body: {} });

    expect(result.status).toBe(409);
    expect(result.json.error.message).toMatch(/approval/i);

    // And nothing moved.
    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.submittedAt).toBeUndefined();
    expect(detail.json.case.officialReference).toBeUndefined();
  });

  it('runs the whole plan once approved', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });

    expect(result.status).toBe(200);
    expect(result.json.completed).toBe(true);

    const actions = result.json.steps.map((step: any) => step.action);
    expect(actions).toEqual([
      'resolve_jurisdiction',
      'validate_evidence',
      'find_official_channel',
      'generate_complaint',
      'prepare_submission',
      'submit_complaint',
      'verify_submission',
      'capture_reference',
      'notify_user',
    ]);
    expect(result.json.steps.every((step: any) => typeof step.title === 'string')).toBe(true);
  });

  it('always marks a simulated submission as simulated', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });

    // Three independent markers, because presenting a simulation as a real
    // government submission would be the worst thing this product could do.
    expect(result.json.simulated).toBe(true);
    expect(result.json.submissionMode).toBe('SIMULATED');
    expect(result.json.reference).toMatch(/^CS-DEMO-\d{5}$/);
    expect(result.json.case.submissionMode).toBe('SIMULATED');

    const submitStep = result.json.steps.find((step: any) => step.action === 'submit_complaint');
    expect(submitStep.detail).toMatch(/demo submission environment/i);
  });

  it('produces a stable reference for the same case', async () => {
    const caseId = await createCase(harness);
    expect(demoReference(caseId)).toBe(demoReference(caseId));
    expect(demoReference(caseId)).not.toBe(demoReference(`${caseId}x`));
  });

  it('refuses a second submission on the same case', async () => {
    const caseId = await createCase(harness);
    await harness.call('POST', `/cases/${caseId}/agent/submit`, { user: ALICE, body: { approve: true } });

    const again = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/already been submitted/i);
  });

  it('refuses to submit a complaint that still has blanks', async () => {
    // No reporter name or contact, so the template keeps its placeholders.
    const caseId = await createCase(harness, { facts: { sinceWhen: 'for 5 days' } });
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(result.status).toBe(409);
    expect(result.json.error.message).toMatch(/blanks/i);
  });

  it('refuses to act on another citizen’s case', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: BOB,
      body: { approve: true },
    });
    // 404 rather than 403: the existence of other people's cases is not
    // disclosed, exactly as on every other path.
    expect(result.status).toBe(404);
  });

  it('requires a session', async () => {
    const caseId = await createCase(harness);
    expect((await harness.call('POST', `/cases/${caseId}/agent/submit`, { body: { approve: true } })).status).toBe(401);
  });

  it('records what it did on the timeline, attributed to the agent', async () => {
    const caseId = await createCase(harness);
    await harness.call('POST', `/cases/${caseId}/agent/submit`, { user: ALICE, body: { approve: true } });

    const timeline = await harness.call('GET', `/cases/${caseId}/timeline`, { user: ALICE });
    const agentEvents = timeline.json.timeline.filter((event: any) => event.actor === 'agent');
    expect(agentEvents.length).toBeGreaterThan(4);
    expect(agentEvents.some((event: any) => event.type === 'MARKED_SUBMITTED')).toBe(true);
  });

  it('computes a follow-up date so the case enters monitoring', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(result.json.case.followUpAt).toBeTruthy();
    expect(result.json.phase).toBe('SUBMITTED');
  });
});

describe('agent follow-up', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  async function submitted() {
    const caseId = await createCase(harness);
    await harness.call('POST', `/cases/${caseId}/agent/submit`, { user: ALICE, body: { approve: true } });
    return caseId;
  }

  it('prepares a follow-up without sending it', async () => {
    const caseId = await submitted();
    const result = await harness.call('POST', `/cases/${caseId}/agent/follow-up`, { user: ALICE, body: {} });

    expect(result.status).toBe(200);
    expect(result.json.completed).toBe(false);
    // The citizen gets to read the exact message before anything goes out.
    expect(result.json.draft).toMatch(/Follow-up on complaint CS-DEMO-/);
    // The summary is spliced mid-sentence, so its trailing stop must go.
    expect(result.json.draft).not.toMatch(/\.\s+at\s/);

    const sendStep = result.json.steps.find((step: any) => step.action === 'send_follow_up');
    expect(sendStep.status).toBe('BLOCKED');
  });

  it('sends it once approved and advances the case', async () => {
    const caseId = await submitted();
    harness.clock.advanceDays(9);

    const result = await harness.call('POST', `/cases/${caseId}/agent/follow-up`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(result.json.completed).toBe(true);
    expect(result.json.case.status).toBe('AWAITING_RESPONSE');
    expect(result.json.steps.some((step: any) => step.action === 'evaluate_escalation')).toBe(true);
  });

  it('refuses a follow-up before the complaint was submitted', async () => {
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/follow-up`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(result.status).toBe(409);
  });
});

describe('agent policy', () => {
  const base = {
    confirmedEvidence: 1,
    now: new Date('2026-03-01T00:00:00.000Z'),
  };

  const draft = {
    caseId: 'case_x',
    ownerId: ALICE,
    status: 'READY_TO_SUBMIT' as const,
    categoryId: 'GARBAGE_SANITATION' as const,
    urgency: 'MEDIUM' as const,
    description: 'Garbage.',
    summary: 'Garbage.',
    location: { city: 'Bengaluru' },
    pathId: 'PATH_GARBAGE_V1',
    authorityId: 'MUNICIPAL_SANITATION',
    complaint: { subject: 'Subject', body: 'Body with no blanks', placeholders: [], provenance: 'DETERMINISTIC_RULES' as const, editedByUser: false },
    escalationLevel: 0,
    evidenceCount: 1,
    isDemo: false,
    classifiedBy: 'DETERMINISTIC_RULES' as const,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  it('blocks every acting step without approval and allows read-only ones', () => {
    const context = { ...base, record: draft, approved: false };
    expect(checkAction('submit_complaint', context).allowed).toBe(false);
    expect(checkAction('prepare_submission', context).allowed).toBe(false);
    expect(checkAction('send_follow_up', context).allowed).toBe(false);

    expect(checkAction('resolve_jurisdiction', context).allowed).toBe(true);
    expect(checkAction('validate_evidence', context).allowed).toBe(true);
    expect(checkAction('find_official_channel', context).allowed).toBe(true);
  });

  it('blocks acting on a closed case even with approval', () => {
    const context = { ...base, record: { ...draft, status: 'RESOLVED' as const }, approved: true };
    expect(checkAction('submit_complaint', context).allowed).toBe(false);
    expect(checkAction('send_follow_up', context).allowed).toBe(false);
  });

  it('prefers a verified official channel over a generic template', () => {
    const { channel, isVerified } = selectSubmissionChannel(draft);
    // Sanitation has the Swachhata app, which is a genuine national channel.
    expect(isVerified).toBe(true);
    expect(channel.isSample).toBe(false);
  });

  it('derives the phase from the record rather than storing it', () => {
    expect(casePhase({ ...draft, complaint: { ...draft.complaint, placeholders: ['YOUR_NAME'], body: 'Hi [[YOUR_NAME]]' } })).toBe(
      'PREPARING',
    );
    expect(casePhase(draft)).toBe('AWAITING_APPROVAL');
    expect(casePhase({ ...draft, status: 'SUBMITTED', submittedAt: '2026-03-01T00:00:00.000Z' }, new Date('2026-03-02T00:00:00.000Z'))).toBe(
      'SUBMITTED',
    );
    expect(
      casePhase(
        { ...draft, status: 'SUBMITTED', submittedAt: '2026-03-01T00:00:00.000Z', followUpAt: '2026-03-02T00:00:00.000Z' },
        new Date('2026-03-20T00:00:00.000Z'),
      ),
    ).toBe('ESCALATION_READY');
    expect(casePhase({ ...draft, status: 'RESOLVED' })).toBe('RESOLVED');
  });
});

describe('no real-world side effects', () => {
  it('ships a rewards catalogue that claims no real partners', () => {
    expect(REWARDS.every((reward) => reward.isSampleCatalog)).toBe(true);
  });

  it('never issues a reference that could pass for a government one', async () => {
    const harness = createHarness();
    const caseId = await createCase(harness);
    const result = await harness.call('POST', `/cases/${caseId}/agent/submit`, {
      user: ALICE,
      body: { approve: true },
    });
    expect(result.json.reference.startsWith('CS-DEMO-')).toBe(true);
  });
});
