import type { CaseRepository } from '../ports/index.js';
import { DEMO_SPECS, seedDemoData, type SeedResult } from './seed.js';

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
  for (const record of shared.cases) {
    const caseId = `${record.caseId}_${guestUserId}`;
    await repository.createCase({ ...record, caseId, ownerId: guestUserId });
    for (const event of shared.events.filter((entry) => entry.caseId === record.caseId)) {
      await repository.appendEvent({ ...event, caseId, actor: guestUserId });
    }
    caseIds.push(caseId);
  }

  await repository.putUser({
    userId: guestUserId,
    displayName: 'Demo visitor',
    role: 'CITIZEN',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  return { seeded: caseIds.length, caseIds };
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
}

export { DEMO_SPECS };
