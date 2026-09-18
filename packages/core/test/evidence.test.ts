import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { MAX_EVIDENCE_PER_CASE } from '../src/services/evidence-service.js';
import { MAX_EVIDENCE_BYTES } from '../src/schemas/common.js';

const ALICE = 'citizen-alice';
const BOB = 'citizen-bob';

function caseBody() {
  return {
    description: 'A large pothole has opened up at the junction and two riders have already skidded on it.',
    categoryId: 'ROAD_DAMAGE',
    location: { locality: 'Kothrud junction', city: 'Pune' },
    facts: { reporterName: 'Alice', reporterContact: 'alice@example.invalid', sinceWhen: 'two weeks' },
  };
}

describe('evidence upload', () => {
  let harness: TestHarness;
  let caseId: string;

  beforeEach(async () => {
    harness = createHarness();
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    caseId = created.json.case.caseId;
  });

  it('reserves, confirms and lists evidence with a signed download URL', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'pothole.jpg', contentType: 'image/jpeg', sizeBytes: 250_000, label: 'The pothole' },
    });
    expect(reserved.status).toBe(201);
    expect(reserved.json.uploadUrl).toContain('local-upload');
    expect(reserved.json.headers['content-type']).toBe('image/jpeg');

    // Not listed until confirmed — we never record evidence that may not exist.
    const beforeConfirm = await harness.call('GET', `/cases/${caseId}/evidence`, { user: ALICE });
    expect(beforeConfirm.json.evidence).toHaveLength(0);

    const confirmed = await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.evidence.confirmed).toBe(true);

    const listed = await harness.call('GET', `/cases/${caseId}/evidence`, { user: ALICE });
    expect(listed.json.evidence).toHaveLength(1);
    expect(listed.json.evidence[0].downloadUrl).toContain('local-download');
    // The raw storage key must never be exposed to the client.
    expect(listed.json.evidence[0].storageKey).toBeUndefined();

    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.evidenceCount).toBe(1);
    expect(detail.json.plan.evidence.find((item: any) => item.key === 'photo').satisfied).toBe(true);
    expect(detail.json.timeline.some((event: any) => event.type === 'EVIDENCE_ADDED')).toBe(true);
  });

  it('derives the storage key from ids, never from the client filename', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: '../../../etc/passwd', contentType: 'image/png', sizeBytes: 1000 },
    });
    expect(reserved.status).toBe(201);
    const stored = await harness.repository.getEvidence(caseId, reserved.json.evidenceId);
    expect(stored?.storageKey).toBe(`cases/${ALICE}/${caseId}/${reserved.json.evidenceId}.png`);
    expect(stored?.storageKey).not.toContain('..');
  });

  it('rejects an unsupported content type', async () => {
    const result = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'payload.svg', contentType: 'image/svg+xml', sizeBytes: 1000 },
    });
    expect(result.status).toBe(422);
    expect(result.json.error.issues[0].message).toMatch(/JPEG, PNG/);
  });

  it('rejects an oversized file at reservation time', async () => {
    const result = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'huge.jpg', contentType: 'image/jpeg', sizeBytes: MAX_EVIDENCE_BYTES + 1 },
    });
    expect(result.status).toBe(422);
  });

  it('refuses to confirm an upload that never landed in the bucket', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'ghost.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    // Simulate the browser abandoning the PUT.
    await harness.storage.deleteObject(`cases/${ALICE}/${caseId}/${reserved.json.evidenceId}.jpg`);
    const result = await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });
    expect(result.status).toBe(409);
    expect(result.json.error.message).toMatch(/not finished uploading/);
  });

  it('is idempotent on confirmation', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });
    await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });
    const detail = await harness.call('GET', `/cases/${caseId}`, { user: ALICE });
    expect(detail.json.case.evidenceCount).toBe(1);
  });

  it('caps the number of files per case', async () => {
    for (let index = 0; index < MAX_EVIDENCE_PER_CASE; index += 1) {
      const result = await harness.call('POST', `/cases/${caseId}/evidence`, {
        user: ALICE,
        body: { fileName: `photo-${index}.jpg`, contentType: 'image/jpeg', sizeBytes: 1000 },
      });
      expect(result.status).toBe(201);
    }
    const overflow = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'one-too-many.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    expect(overflow.status).toBe(409);
  });

  it('never lets another citizen reserve, confirm or read evidence', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });

    expect(
      (
        await harness.call('POST', `/cases/${caseId}/evidence`, {
          user: BOB,
          body: { fileName: 'b.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
          user: BOB,
          body: { evidenceId: reserved.json.evidenceId },
        })
      ).status,
    ).toBe(404);

    expect((await harness.call('GET', `/cases/${caseId}/evidence`, { user: BOB })).status).toBe(404);
  });

  it('returns a fresh short-lived URL on each listing rather than a stored one', async () => {
    const reserved = await harness.call('POST', `/cases/${caseId}/evidence`, {
      user: ALICE,
      body: { fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    await harness.call('POST', `/cases/${caseId}/evidence/confirm`, {
      user: ALICE,
      body: { evidenceId: reserved.json.evidenceId },
    });

    const first = await harness.call('GET', `/cases/${caseId}/evidence`, { user: ALICE });
    harness.clock.advanceDays(1);
    const second = await harness.call('GET', `/cases/${caseId}/evidence`, { user: ALICE });
    // The stub encodes an expiry into the URL, so a re-issued URL differs.
    expect(second.json.evidence[0].downloadUrl).not.toBe(first.json.evidence[0].downloadUrl);
  });
});
