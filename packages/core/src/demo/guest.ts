import type { CaseRepository } from '../ports/index.js';
import { DEMO_POINTS, DEMO_SPECS, seedDemoData, type SeedResult } from './seed.js';
import { newNotificationId, timeOrderedId } from '../domain/ids.js';
import { addDays, unixSeconds } from '../util/time.js';

/**
 * Per-guest demo seeding.
 *
 * The demo cases are cloned under the guest's own user id and with guest-scoped
 * case ids, so two judges running the demo at the same time cannot see or
 * disturb each other's data — and neither can touch a real citizen's case.
 */
export async function seedGuestDemoData(
  repository: CaseRepository,
  guestUserId: string,
  now: Date = new Date(),
): Promise<SeedResult> {
  // Reuse the canonical builder, then re-key the records for this guest.
  const shared = new CollectingRepository();
  await seedDemoData(shared, now);

  const caseIds: string[] = [];
  // The records as actually persisted — re-keyed for this guest. Everything
  // seeded afterwards must reference these ids, not the canonical ones.
  const guestCases: typeof shared.cases = [];

  for (const record of shared.cases) {
    const caseId = `${record.caseId}_${guestUserId}`;
    const guestRecord = { ...record, caseId, ownerId: guestUserId };
    await repository.createCase(guestRecord);
    for (const event of shared.events.filter((entry) => entry.caseId === record.caseId)) {
      await repository.appendEvent({ ...event, caseId, actor: guestUserId });
    }
    caseIds.push(caseId);
    guestCases.push(guestRecord);
  }

  await seedGuestNotifications(repository, guestUserId, guestCases, now);
  await seedGuestPointsLedger(repository, guestUserId, guestCases, now);

  await repository.putUser({
    userId: guestUserId,
    displayName: 'Demo visitor',
    role: 'CITIZEN',
    civicPoints: DEMO_POINTS,
    lifetimePoints: DEMO_POINTS,
    casesReported: caseIds.length,
    casesResolved: guestCases.filter((record) => record.status === 'RESOLVED').length,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  return { seeded: caseIds.length, caseIds };
}

/**
 * Seeds the notifications a citizen with these cases would already have.
 *
 * Without this the notification bell is empty on a fresh demo session, which
 * makes the reminder mechanism — the thing that actually turns a filed
 * complaint into a resolved one — invisible to anyone evaluating the product.
 */
async function seedGuestNotifications(
  repository: CaseRepository,
  guestUserId: string,
  cases: Array<{ caseId: string; status: string; summary: string }>,
  now: Date,
): Promise<void> {
  const find = (fragment: string) => cases.find((record) => record.caseId.includes(fragment));
  const overdue = find('garbage_overdue');
  const resolved = find('pothole_resolved');
  const submitted = find('streetlight_submitted');

  const ttl = unixSeconds(addDays(now, 60));
  const at = (daysAgo: number) => addDays(now, -daysAgo).toISOString();

  const seeded: Array<{ caseId?: string; kind: 'FOLLOW_UP_DUE' | 'ESCALATION_AVAILABLE' | 'POINTS_EARNED' | 'CASE_CREATED'; title: string; body: string; read: boolean; daysAgo: number }> = [
    {
      caseId: overdue?.caseId,
      kind: 'ESCALATION_AVAILABLE',
      title: 'Escalation step 2 now applies',
      body: 'It has been 20 days with no resolution. You can escalate to the ward sanitary inspector.',
      read: false,
      daysAgo: 1,
    },
    {
      caseId: overdue?.caseId,
      kind: 'FOLLOW_UP_DUE',
      title: 'Follow-up reminder',
      body: "It's time to follow up on your case. Chase it with your complaint number.",
      read: false,
      daysAgo: 2,
    },
    {
      caseId: resolved?.caseId,
      kind: 'POINTS_EARNED',
      title: '+100 Civic Points earned',
      body: 'Your problem was resolved. The pothole at Kothrud junction has been repaired.',
      read: true,
      daysAgo: 12,
    },
    {
      caseId: submitted?.caseId,
      kind: 'CASE_CREATED',
      title: 'Complaint submitted',
      body: 'Your complaint was recorded as submitted. We will remind you when to follow up.',
      read: true,
      daysAgo: 3,
    },
  ];

  for (const entry of seeded) {
    if (!entry.caseId) continue;
    const createdAt = at(entry.daysAgo);
    await repository.putNotification({
      notificationId: newNotificationId(new Date(createdAt)),
      userId: guestUserId,
      caseId: entry.caseId,
      kind: entry.kind,
      title: entry.title,
      body: entry.body,
      read: entry.read,
      createdAt,
      expiresAt: ttl,
    });
  }
}

/**
 * Seeds the points ledger entries behind the demo citizen's balance.
 *
 * The profile's totals are seeded directly, so without matching ledger entries
 * the profile would show a balance with no explanation of where it came from —
 * and the per-case points on the case list would be blank.
 */
async function seedGuestPointsLedger(
  repository: CaseRepository,
  guestUserId: string,
  cases: Array<{ caseId: string; status: string; createdAt: string }>,
  now: Date,
): Promise<void> {
  for (const record of cases) {
    const entries: Array<{ reason: 'REPORT_CREATED' | 'COMPLETE_INFORMATION' | 'CASE_RESOLVED'; delta: number; label: string }> = [
      { reason: 'REPORT_CREATED', delta: 50, label: 'Reported a civic issue' },
      { reason: 'COMPLETE_INFORMATION', delta: 10, label: 'Completed every required detail' },
    ];
    if (record.status === 'RESOLVED') {
      entries.push({ reason: 'CASE_RESOLVED', delta: 100, label: 'Problem resolved' });
    }

    for (const entry of entries) {
      await repository.putPointsEntry({
        entryId: timeOrderedId('pts', new Date(record.createdAt)),
        userId: guestUserId,
        reason: entry.reason,
        delta: entry.delta,
        label: entry.label,
        caseId: record.caseId,
        dedupeKey: `${entry.reason}#${record.caseId}`,
        createdAt: record.createdAt,
      });
    }
  }
  void now;
}

/**
 * Tiny in-process sink that captures what `seedDemoData` would write, so the
 * demo fixtures live in exactly one place. Only the handful of methods the
 * seeder calls do anything.
 */
class CollectingRepository implements CaseRepository {
  readonly cases: Array<Parameters<CaseRepository['createCase']>[0]> = [];
  readonly events: Array<Parameters<CaseRepository['appendEvent']>[0]> = [];

  async createCase(record: Parameters<CaseRepository['createCase']>[0]) {
    this.cases.push(record);
    return { record, created: true };
  }
  async appendEvent(event: Parameters<CaseRepository['appendEvent']>[0]) {
    this.events.push(event);
  }
  async getCase() {
    return undefined;
  }
  async updateCase(record: Parameters<CaseRepository['updateCase']>[0]) {
    return record;
  }
  async listCasesByOwner() {
    return { items: [] };
  }
  async listCasesByStatus() {
    return { items: [] };
  }
  async listCasesDueForFollowUp() {
    return [];
  }
  async listEvents() {
    return [];
  }
  async putEvidence() {}
  async getEvidence() {
    return undefined;
  }
  async listEvidence() {
    return [];
  }
  async putAudit() {}
  async listAudit() {
    return [];
  }
  async putNotification() {}
  async listNotifications() {
    return [];
  }
  async markNotificationRead() {}
  async getUser() {
    return undefined;
  }
  async putUser(profile: Parameters<CaseRepository['putUser']>[0]) {
    return profile;
  }
  async putPointsEntry() {
    return true;
  }
  async listPointsEntries() {
    return [];
  }
  async bumpUserCounters(userId: string) {
    return {
      userId,
      role: 'CITIZEN' as const,
      civicPoints: 0,
      lifetimePoints: 0,
      casesReported: 0,
      casesResolved: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  async putRedemption() {}
  async listRedemptions() {
    return [];
  }
}

export { DEMO_SPECS };
