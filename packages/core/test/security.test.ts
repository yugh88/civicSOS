import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TEST_GUEST_SECRET, type TestHarness } from './helpers.js';
import { createAuthResolver, issueGuestToken, roleFromGroups, verifyGuestToken } from '../src/http/auth.js';
import { createLogger } from '../src/util/logger.js';
import { SECURITY_HEADERS } from '../src/http/responses.js';
import { MAX_REQUEST_BYTES } from '../src/schemas/common.js';
import { isSafeId } from '../src/domain/ids.js';

const ALICE = 'citizen-alice';
const BOB = 'citizen-bob';
const logger = createLogger({}, 'error');

function caseBody() {
  return {
    description: 'Street light outside my house has been dead for three weeks and the lane is pitch dark.',
    categoryId: 'STREETLIGHT',
    location: { locality: 'Sector 21', city: 'Gurugram' },
    facts: { reporterName: 'Alice', reporterContact: 'alice@example.invalid', sinceWhen: 'three weeks' },
  };
}

describe('authentication', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('rejects every private endpoint without credentials', async () => {
    const endpoints: Array<[string, string]> = [
      ['GET', '/cases'],
      ['POST', '/cases'],
      ['POST', '/cases/analyze'],
      ['GET', '/cases/case_abc'],
      ['PATCH', '/cases/case_abc'],
      ['GET', '/cases/case_abc/timeline'],
      ['POST', '/cases/case_abc/resolve'],
      ['POST', '/cases/case_abc/follow-up'],
      ['GET', '/cases/case_abc/evidence'],
      ['GET', '/me'],
      ['GET', '/admin/overview'],
    ];
    for (const [method, path] of endpoints) {
      const result = await harness.call(method, path, { body: method === 'GET' ? undefined : {} });
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.json.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('allows the health check and the public category catalogue', async () => {
    expect((await harness.call('GET', '/health')).status).toBe(200);
    const knowledge = await harness.call('GET', '/knowledge/categories');
    expect(knowledge.status).toBe(200);
    expect(knowledge.json.categories.length).toBeGreaterThan(4);
  });

  it('rejects a garbage bearer token rather than falling through to dev headers', async () => {
    const result = await harness.call('GET', '/cases', { token: 'not-a-real-token' });
    expect(result.status).toBe(401);
  });
});

describe('guest demo sessions', () => {
  it('signs, verifies and expires guest tokens', async () => {
    const issued = await issueGuestToken(TEST_GUEST_SECRET, new Date('2026-03-01T00:00:00.000Z'));
    expect(issued.userId).toMatch(/^guest_/);

    const verified = await verifyGuestToken(TEST_GUEST_SECRET, issued.token, new Date('2026-03-01T01:00:00.000Z'));
    expect(verified?.userId).toBe(issued.userId);

    const expired = await verifyGuestToken(TEST_GUEST_SECRET, issued.token, new Date('2026-03-02T00:00:00.000Z'));
    expect(expired).toBeUndefined();
  });

  it('rejects a token signed with a different secret', async () => {
    const issued = await issueGuestToken('another-secret-that-is-long-enough-here');
    expect(await verifyGuestToken(TEST_GUEST_SECRET, issued.token)).toBeUndefined();
  });

  it('rejects a tampered payload', async () => {
    const issued = await issueGuestToken(TEST_GUEST_SECRET);
    const [, signature] = issued.token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ userId: 'guest_evil', exp: 9999999999 })).toString('base64url')}.${signature}`;
    expect(await verifyGuestToken(TEST_GUEST_SECRET, forged)).toBeUndefined();
  });

  it('refuses to issue a token with a weak secret', async () => {
    await expect(issueGuestToken('short')).rejects.toThrow();
  });

  it('gives each guest their own isolated copy of the demo data', async () => {
    const harness = createHarness();
    const first = await harness.call('POST', '/auth/guest', { body: {} });
    const second = await harness.call('POST', '/auth/guest', { body: {} });
    expect(first.status).toBe(201);
    expect(first.json.userId).not.toBe(second.json.userId);
    expect(first.json.seededCases).toBeGreaterThan(0);

    const firstCases = await harness.call('GET', '/cases', { token: first.json.token });
    const secondCases = await harness.call('GET', '/cases', { token: second.json.token });
    expect(firstCases.json.cases.length).toBe(first.json.seededCases);
    expect(firstCases.json.cases.every((row: any) => row.isDemo)).toBe(true);

    // No overlap at all between two guests.
    const firstIds = new Set(firstCases.json.cases.map((row: any) => row.caseId));
    expect(secondCases.json.cases.some((row: any) => firstIds.has(row.caseId))).toBe(false);

    // And a guest cannot read the other guest's case by id.
    const stolen = await harness.call('GET', `/cases/${secondCases.json.cases[0].caseId}`, {
      token: first.json.token,
    });
    expect(stolen.status).toBe(404);
  });
});

describe('cross-user access control', () => {
  let harness: TestHarness;
  let aliceCaseId: string;

  beforeEach(async () => {
    harness = createHarness();
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    aliceCaseId = created.json.case.caseId;
  });

  it("hides another citizen's case behind a 404, not a 403", async () => {
    const result = await harness.call('GET', `/cases/${aliceCaseId}`, { user: BOB });
    // A 403 would confirm the id exists, which leaks the existence of other
    // citizens' cases to anyone enumerating ids.
    expect(result.status).toBe(404);
  });

  it("blocks every write path against another citizen's case", async () => {
    const attempts: Array<[string, string, unknown]> = [
      ['PATCH', `/cases/${aliceCaseId}`, { note: 'hacked' }],
      ['POST', `/cases/${aliceCaseId}/submitted`, {}],
      ['POST', `/cases/${aliceCaseId}/follow-up`, {}],
      ['POST', `/cases/${aliceCaseId}/resolve`, { outcome: 'FIXED' }],
      ['POST', `/cases/${aliceCaseId}/evidence`, { fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 100 }],
      ['GET', `/cases/${aliceCaseId}/timeline`, undefined],
      ['GET', `/cases/${aliceCaseId}/evidence`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const result = await harness.call(method, path, { user: BOB, body });
      expect(result.status, `${method} ${path}`).toBe(404);
    }
    // Alice's case is untouched.
    const detail = await harness.call('GET', `/cases/${aliceCaseId}`, { user: ALICE });
    expect(detail.json.case.status).toBe('READY_TO_SUBMIT');
  });

  it("never lists another citizen's cases", async () => {
    await harness.call('POST', '/cases', { user: BOB, body: caseBody() });
    const bobList = await harness.call('GET', '/cases', { user: BOB });
    expect(bobList.json.cases).toHaveLength(1);
    expect(bobList.json.cases[0].ownerId).toBe(BOB);
  });

  it('lets staff read but not rewrite a citizen complaint', async () => {
    const read = await harness.call('GET', `/cases/${aliceCaseId}`, { user: 'officer-1', role: 'AUTHORITY' });
    expect(read.status).toBe(200);

    const write = await harness.call('PATCH', `/cases/${aliceCaseId}`, {
      user: 'officer-1',
      role: 'AUTHORITY',
      body: { complaint: { body: 'rewritten by staff' } },
    });
    expect(write.status).toBe(403);
  });

  it('ignores a role claimed in the request body', async () => {
    const result = await harness.call('PATCH', '/me', {
      user: BOB,
      body: { displayName: 'Bob', role: 'ADMIN' },
    });
    expect(result.status).toBe(200);
    expect(result.json.profile.role).toBe('CITIZEN');
  });
});

describe('admin authorization', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('refuses the admin dashboard to citizens and to authority staff', async () => {
    expect((await harness.call('GET', '/admin/overview', { user: ALICE })).status).toBe(403);
    expect((await harness.call('GET', '/admin/overview', { user: 'officer', role: 'AUTHORITY' })).status).toBe(403);
  });

  it('allows an admin through', async () => {
    const result = await harness.call('GET', '/admin/overview', { user: 'root', role: 'ADMIN' });
    expect(result.status).toBe(200);
    expect(result.json.totals).toBeDefined();
  });

  it('separates demo counts from real counts', async () => {
    await harness.call('POST', '/auth/guest', { body: {} });
    await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const result = await harness.call('GET', '/admin/overview', { user: 'root', role: 'ADMIN' });
    expect(result.json.totals.demo).toBeGreaterThan(0);
    expect(result.json.totals.real).toBe(1);
  });

  it('records an audit entry for every denial and every admin action', async () => {
    await harness.call('GET', '/admin/overview', { user: 'root', role: 'ADMIN' });
    const audit = await harness.repository.listAudit(new Date(harness.clock.now()).toISOString().slice(0, 10), 50);
    expect(audit.some((entry) => entry.action === 'ADMIN_OVERVIEW' && entry.outcome === 'ALLOW')).toBe(true);
  });

  it('maps cognito groups to roles and never trusts an unknown group', () => {
    expect(roleFromGroups(['ADMIN'])).toBe('ADMIN');
    expect(roleFromGroups(['authority'])).toBe('AUTHORITY');
    expect(roleFromGroups(['SUPERUSER'])).toBe('CITIZEN');
    expect(roleFromGroups(undefined)).toBe('CITIZEN');
  });
});

describe('input validation and request limits', () => {
  let harness: TestHarness;
  beforeEach(() => {
    harness = createHarness();
  });

  it('rejects a too-short description with a field-level issue', async () => {
    const result = await harness.call('POST', '/cases/analyze', { user: ALICE, body: { description: 'hi' } });
    expect(result.status).toBe(422);
    expect(result.json.error.issues[0].field).toBe('description');
  });

  it('rejects a missing required field', async () => {
    const result = await harness.call('POST', '/cases', {
      user: ALICE,
      body: { description: 'The road outside is completely broken up.' },
    });
    expect(result.status).toBe(422);
    expect(result.json.error.issues.some((issue: any) => issue.field === 'categoryId')).toBe(true);
  });

  it('rejects an invalid enum value', async () => {
    const result = await harness.call('POST', '/cases', {
      user: ALICE,
      body: { ...caseBody(), categoryId: 'NOT_A_CATEGORY' },
    });
    expect(result.status).toBe(422);
  });

  it('rejects malformed JSON', async () => {
    const response = await harness.router.handle({
      method: 'POST',
      path: '/cases/analyze',
      query: {},
      headers: { 'content-type': 'application/json', 'x-dev-user': ALICE },
      body: '{"description": ',
    });
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not declared as JSON', async () => {
    const response = await harness.router.handle({
      method: 'POST',
      path: '/cases/analyze',
      query: {},
      headers: { 'content-type': 'text/plain', 'x-dev-user': ALICE },
      body: 'description=hello',
    });
    expect(response.status).toBe(415);
  });

  it('rejects an oversized body before parsing it', async () => {
    const response = await harness.router.handle({
      method: 'POST',
      path: '/cases/analyze',
      query: {},
      headers: { 'content-type': 'application/json', 'x-dev-user': ALICE },
      body: JSON.stringify({ description: 'x'.repeat(MAX_REQUEST_BYTES + 1000) }),
    });
    expect(response.status).toBe(413);
  });

  it('rejects an unsafe case id without touching the repository', async () => {
    const result = await harness.call('GET', '/cases/..%2F..%2Fetc%2Fpasswd', { user: ALICE });
    expect(result.status).toBe(404);
    expect(isSafeId('../../etc/passwd')).toBe(false);
  });

  it('returns 404 for an unknown route and 400 for a wrong method', async () => {
    expect((await harness.call('GET', '/nope', { user: ALICE })).status).toBe(404);
    expect((await harness.call('DELETE', '/cases', { user: ALICE })).status).toBe(400);
  });

  it('rejects an update with no fields at all', async () => {
    const created = await harness.call('POST', '/cases', { user: ALICE, body: caseBody() });
    const result = await harness.call('PATCH', `/cases/${created.json.case.caseId}`, { user: ALICE, body: {} });
    expect(result.status).toBe(422);
  });

  it('coarsens coordinates at the trust boundary', async () => {
    const created = await harness.call('POST', '/cases', {
      user: ALICE,
      body: { ...caseBody(), location: { city: 'Bengaluru', lat: 12.9715987, lng: 77.5945627, source: 'BROWSER' } },
    });
    expect(created.json.case.location.lat).toBe(12.97);
    expect(created.json.case.location.lng).toBe(77.59);
  });
});

describe('rate limiting', () => {
  it('limits the AI-backed analyze endpoint per user', async () => {
    const harness = createHarness({ rateLimit: 3 });
    const body = { description: 'The garbage outside my flat has not been collected for four days now.' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await harness.call('POST', '/cases/analyze', { user: ALICE, body })).status).toBe(200);
    }
    const limited = await harness.call('POST', '/cases/analyze', { user: ALICE, body });
    expect(limited.status).toBe(429);

    // The allowance is per user, so Bob is unaffected.
    expect((await harness.call('POST', '/cases/analyze', { user: BOB, body })).status).toBe(200);
  });
});

describe('response headers', () => {
  it('sets the security headers on every response', async () => {
    const harness = createHarness();
    const result = await harness.call('GET', '/health');
    for (const header of Object.keys(SECURITY_HEADERS)) {
      expect(result.headers[header], header).toBeDefined();
    }
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('echoes only an allow-listed origin for CORS', async () => {
    const harness = createHarness();
    const allowed = await harness.router.handle({
      method: 'GET',
      path: '/health',
      query: {},
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await harness.router.handle({
      method: 'GET',
      path: '/health',
      query: {},
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never returns a wildcard origin', async () => {
    const harness = createHarness();
    const result = await harness.call('GET', '/health');
    expect(result.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('includes the request id in every error body', async () => {
    const harness = createHarness();
    const result = await harness.call('GET', '/cases');
    expect(result.json.error.requestId).toMatch(/^req_/);
  });
});

describe('dev header authentication is fenced off', () => {
  it('is refused outside the local stage', async () => {
    const resolver = createAuthResolver({ logger, devHeaders: { enabled: true, stage: 'prod' } });
    const auth = await resolver.resolve(
      { method: 'GET', path: '/cases', query: {}, headers: { 'x-dev-user': 'attacker', 'x-dev-role': 'ADMIN' } },
      'req_1',
    );
    expect(auth).toBeUndefined();
  });

  it('is inert when not explicitly enabled', async () => {
    const resolver = createAuthResolver({ logger });
    const auth = await resolver.resolve(
      { method: 'GET', path: '/cases', query: {}, headers: { 'x-dev-user': 'attacker' } },
      'req_1',
    );
    expect(auth).toBeUndefined();
  });
});
