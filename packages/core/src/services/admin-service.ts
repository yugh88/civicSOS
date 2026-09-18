import type { AuthContext, CaseStatus } from '../domain/types.js';
import type { ServiceContext } from './context.js';
import { requireRole } from './authorization.js';
import { CASE_STATUSES } from '../domain/types.js';
import { CATEGORY_LIST } from '../knowledge/categories.js';
import { dayKey } from '../util/time.js';

/**
 * Admin service — minimal but genuinely functional.
 *
 * Aggregates are computed from status-index queries rather than a table scan, so
 * the dashboard stays cheap as the table grows. Demo cases are counted
 * separately and never folded into the real numbers.
 */

export interface AdminOverview {
  stage: string;
  generatedAt: string;
  totals: {
    byStatus: Record<CaseStatus, number>;
    byCategory: Record<string, number>;
    open: number;
    resolved: number;
    demo: number;
    real: number;
  };
  /** Cases past their follow-up date right now. */
  overdue: Array<{ caseId: string; summary: string; status: CaseStatus; followUpAt?: string; isDemo: boolean }>;
  recentAudit: Array<{
    action: string;
    actorRole: string;
    resource: string;
    outcome: string;
    createdAt: string;
  }>;
}

/** Caps the per-status page so one request cannot become an expensive query. */
const STATUS_PAGE_LIMIT = 50;

export class AdminService {
  constructor(private readonly ctx: ServiceContext) {}

  async overview(auth: AuthContext): Promise<AdminOverview> {
    requireRole(auth, 'ADMIN');
    const now = this.ctx.clock.now();

    const byStatus = {} as Record<CaseStatus, number>;
    const byCategory: Record<string, number> = {};
    for (const category of CATEGORY_LIST) byCategory[category.categoryId] = 0;

    let demo = 0;
    let real = 0;

    // One query per status against the status GSI.
    const pages = await Promise.all(
      CASE_STATUSES.map(async (status) => ({
        status,
        page: await this.ctx.repository.listCasesByStatus(status, { limit: STATUS_PAGE_LIMIT }),
      })),
    );

    for (const { status, page } of pages) {
      byStatus[status] = page.items.length;
      for (const record of page.items) {
        byCategory[record.categoryId] = (byCategory[record.categoryId] ?? 0) + 1;
        if (record.isDemo) demo += 1;
        else real += 1;
      }
    }

    const overdueCases = await this.ctx.repository.listCasesDueForFollowUp(now.toISOString(), 20);
    const recentAudit = await this.ctx.repository.listAudit(dayKey(now), 25);

    await this.ctx.audit.record({ auth, action: 'ADMIN_OVERVIEW', resource: 'admin/overview', outcome: 'ALLOW' });

    const open =
      (byStatus.DRAFT ?? 0) +
      (byStatus.READY_TO_SUBMIT ?? 0) +
      (byStatus.SUBMITTED ?? 0) +
      (byStatus.AWAITING_RESPONSE ?? 0) +
      (byStatus.ESCALATED ?? 0);

    return {
      stage: this.ctx.config.stage,
      generatedAt: now.toISOString(),
      totals: {
        byStatus,
        byCategory,
        open,
        resolved: byStatus.RESOLVED ?? 0,
        demo,
        real,
      },
      overdue: overdueCases.map((record) => ({
        caseId: record.caseId,
        summary: record.summary,
        status: record.status,
        followUpAt: record.followUpAt,
        isDemo: record.isDemo,
      })),
      recentAudit: recentAudit.map((entry) => ({
        action: entry.action,
        actorRole: entry.actorRole,
        resource: entry.resource,
        outcome: entry.outcome,
        createdAt: entry.createdAt,
      })),
    };
  }

  /** Staff view of a single status queue. */
  async queue(auth: AuthContext, status: CaseStatus, cursor?: string) {
    requireRole(auth, 'AUTHORITY');
    const page = await this.ctx.repository.listCasesByStatus(status, { limit: 25, cursor });
    await this.ctx.audit.record({
      auth,
      action: 'ADMIN_QUEUE',
      resource: `admin/queue/${status}`,
      outcome: 'ALLOW',
    });
    return page;
  }
}
