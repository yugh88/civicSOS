import type { CaseEvent, CaseRecord } from '../domain/types.js';
import type { CaseRepository } from '../ports/index.js';
import { buildComplaintDraft } from '../rules/complaint.js';
import { getResolutionPath } from '../knowledge/resolution-paths.js';
import { computeFollowUpDate } from '../rules/followup.js';
import { isoAddDays, isoNow } from '../util/time.js';

/**
 * Demo data.
 *
 * Every seeded case has `isDemo: true` and belongs to `DEMO_OWNER_ID`, never to
 * a real signed-in user. The UI renders a DEMO badge from that flag and the
 * admin dashboard counts demo and real cases separately, so a judge can see the
 * full journey — including a case old enough to have escalation unlocked —
 * without any doubt about what is real.
 *
 * Dates are relative to "now" so the demo shows a genuinely overdue case on any
 * day it is run, rather than hard-coded dates that rot.
 */

export const DEMO_OWNER_ID = 'demo-citizen';

/**
 * Points the seeded demo citizen starts with.
 *
 * Chosen so the profile shows real progress — partway to Silver Citizen — and
 * so the Rewards page has some entries affordable and some not. Matches what
 * the four seeded cases would actually have earned.
 */
export const DEMO_POINTS = 220;

interface DemoSpec {
  id: string;
  categoryId: CaseRecord['categoryId'];
  description: string;
  summary: string;
  locality: string;
  city: string;
  state: string;
  status: CaseRecord['status'];
  urgency: CaseRecord['urgency'];
  /** Days before now that the case was created. */
  createdDaysAgo: number;
  /** Days before now that it was submitted, if it was. */
  submittedDaysAgo?: number;
  escalationLevel?: number;
  resolvedDaysAgo?: number;
  resolutionNote?: string;
  officialReference?: string;
  evidenceCount?: number;
  sinceWhen: string;
}

const DEMO_SPECS: DemoSpec[] = [
  {
    id: 'demo_garbage_overdue',
    categoryId: 'GARBAGE_SANITATION',
    description:
      'There has been a pile of garbage outside our apartment gate for the last 6 days. The collection van has not come at all this week and the smell is now unbearable. Stray dogs have torn the bags open and the waste is spread across the footpath.',
    summary: 'Uncollected garbage outside an apartment gate for six days, now spread across the footpath.',
    locality: '12th Main, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    status: 'AWAITING_RESPONSE',
    urgency: 'MEDIUM',
    createdDaysAgo: 21,
    submittedDaysAgo: 20,
    officialReference: 'DEMO-SWM-48213',
    evidenceCount: 1,
    sinceWhen: 'for the last 6 days',
  },
  {
    id: 'demo_streetlight_submitted',
    categoryId: 'STREETLIGHT',
    description:
      'The street lights on our lane have not been working for about three weeks. The entire stretch from the bus stop to the school gate is completely dark after 7pm and it feels unsafe to walk there.',
    summary: 'A full stretch of street lighting has been out for around three weeks, leaving the lane dark.',
    locality: 'Sector 21, near the community centre',
    city: 'Gurugram',
    state: 'Haryana',
    status: 'SUBMITTED',
    urgency: 'MEDIUM',
    createdDaysAgo: 4,
    submittedDaysAgo: 3,
    officialReference: 'DEMO-SL-90114',
    evidenceCount: 1,
    sinceWhen: 'for about three weeks',
  },
  {
    id: 'demo_pothole_resolved',
    categoryId: 'ROAD_DAMAGE',
    description:
      'A large pothole had formed right at the junction near our street. Two scooter riders skidded on it during the rains last month.',
    summary: 'A large pothole at a junction that had already caused two scooter skids.',
    locality: 'Kothrud junction',
    city: 'Pune',
    state: 'Maharashtra',
    status: 'RESOLVED',
    urgency: 'HIGH',
    createdDaysAgo: 40,
    submittedDaysAgo: 39,
    resolvedDaysAgo: 12,
    resolutionNote: 'The ward engineer filled the pothole and re-tarred the junction. Verified on a site visit.',
    officialReference: 'DEMO-RD-11902',
    evidenceCount: 2,
    sinceWhen: 'since the rains last month',
  },
  {
    id: 'demo_water_draft',
    categoryId: 'WATER_SEWERAGE',
    description:
      'Water coming from the tap has been muddy and smells strange for the past two days. Around fifteen flats in our building are affected and a few people have complained of stomach upset.',
    summary: 'Muddy, foul-smelling tap water affecting roughly fifteen flats for two days.',
    locality: 'Anand Nagar, Block C',
    city: 'Ahmedabad',
    state: 'Gujarat',
    status: 'DRAFT',
    urgency: 'HIGH',
    createdDaysAgo: 1,
    evidenceCount: 0,
    sinceWhen: 'for the past two days',
  },
];

function buildDemoCase(spec: DemoSpec, now: Date): { record: CaseRecord; events: CaseEvent[] } {
  const createdAt = isoAddDays(now, -spec.createdDaysAgo);
  const submittedAt = spec.submittedDaysAgo !== undefined ? isoAddDays(now, -spec.submittedDaysAgo) : undefined;
  const resolvedAt = spec.resolvedDaysAgo !== undefined ? isoAddDays(now, -spec.resolvedDaysAgo) : undefined;
  const path = getResolutionPath(spec.categoryId);
  const location = { locality: spec.locality, city: spec.city, state: spec.state, source: 'MANUAL' as const };

  const complaint = buildComplaintDraft(
    {
      categoryId: spec.categoryId,
      description: spec.description,
      location,
      sinceWhen: spec.sinceWhen,
      householdsAffected: spec.categoryId === 'WATER_SEWERAGE' ? 'around 15 flats' : undefined,
      reporterName: 'Demo Citizen',
      reporterContact: 'demo@example.invalid',
      now: new Date(createdAt),
    },
    'DEMO_DATA',
  );

  const record: CaseRecord = {
    caseId: spec.id,
    ownerId: DEMO_OWNER_ID,
    status: spec.status,
    categoryId: spec.categoryId,
    urgency: spec.urgency,
    description: spec.description,
    summary: spec.summary,
    location,
    pathId: path.pathId,
    authorityId: path.authorityId,
    complaint,
    officialReference: spec.officialReference,
    submittedAt,
    resolvedAt,
    resolutionNote: spec.resolutionNote,
    escalationLevel: spec.escalationLevel ?? 0,
    evidenceCount: spec.evidenceCount ?? 0,
    isDemo: true,
    classifiedBy: 'DEMO_DATA',
    createdAt,
    updatedAt: resolvedAt ?? submittedAt ?? createdAt,
  };

  // Resolved cases must not carry a follow-up date, or the reminder sweep would
  // pick them up. Everything else gets a computed one.
  record.followUpAt = spec.status === 'RESOLVED' || spec.status === 'CLOSED_UNRESOLVED' ? undefined : computeFollowUpDate(record);

  const events: CaseEvent[] = [
    {
      caseId: spec.id,
      eventId: `${createdAt}#created`,
      type: 'CASE_CREATED',
      message: 'Case created in CivicSOS (demo data).',
      actor: DEMO_OWNER_ID,
      createdAt,
    },
  ];

  if (submittedAt) {
    events.push({
      caseId: spec.id,
      eventId: `${submittedAt}#submitted`,
      type: 'MARKED_SUBMITTED',
      message: 'Submitted through the official channel.',
      actor: DEMO_OWNER_ID,
      createdAt: submittedAt,
    });
  }

  if (spec.status === 'AWAITING_RESPONSE' && submittedAt) {
    const followedUpAt = isoAddDays(submittedAt, 7);
    events.push({
      caseId: spec.id,
      eventId: `${followedUpAt}#followup`,
      type: 'FOLLOW_UP_LOGGED',
      message: 'Called the helpline and quoted the complaint number. Told it is "in process".',
      actor: DEMO_OWNER_ID,
      createdAt: followedUpAt,
    });
  }

  if (resolvedAt) {
    events.push({
      caseId: spec.id,
      eventId: `${resolvedAt}#resolved`,
      type: 'RESOLVED',
      message: spec.resolutionNote ?? 'Marked resolved.',
      actor: DEMO_OWNER_ID,
      createdAt: resolvedAt,
    });
  }

  return { record, events };
}

export interface SeedResult {
  seeded: number;
  caseIds: string[];
}

/**
 * Seeds demo cases. Idempotent — re-running replaces the same fixed ids rather
 * than accumulating duplicates, which matters because the local dev server
 * seeds on every restart.
 */
export async function seedDemoData(repository: CaseRepository, now: Date = new Date()): Promise<SeedResult> {
  const caseIds: string[] = [];

  await repository.putUser({
    userId: DEMO_OWNER_ID,
    displayName: 'Demo Citizen',
    role: 'CITIZEN',
    // Seeded so the demo shows a citizen partway to Silver, with points already
    // earned from the resolved case below.
    civicPoints: DEMO_POINTS,
    lifetimePoints: DEMO_POINTS,
    casesReported: DEMO_SPECS.length,
    casesResolved: DEMO_SPECS.filter((spec) => spec.status === 'RESOLVED').length,
    createdAt: isoNow(now),
    updatedAt: isoNow(now),
  });

  for (const spec of DEMO_SPECS) {
    const { record, events } = buildDemoCase(spec, now);
    const existing = await repository.getCase(record.caseId);
    if (existing) {
      await repository.updateCase(record);
    } else {
      await repository.createCase(record);
      for (const event of events) await repository.appendEvent(event);
    }
    caseIds.push(record.caseId);
  }

  return { seeded: caseIds.length, caseIds };
}

export { DEMO_SPECS };
