import type { AuditEvent, AuthContext } from '../domain/types.js';
import type { CaseRepository } from '../ports/index.js';
import { newAuditId } from '../domain/ids.js';
import { dayKey, isoNow } from '../util/time.js';
import type { Logger } from '../util/logger.js';

/**
 * Immutable audit trail.
 *
 * One record per security-relevant action: who, what, on which resource, and
 * whether it was allowed. Partitioned by calendar day so the trail is queryable
 * without a table scan. Records carry identifiers and outcomes only — never
 * complaint text or personal details.
 *
 * Auditing is best-effort by design: a failure to write the trail must not fail
 * the citizen's request, but it is logged at error level so it is visible.
 */

export interface AuditWriter {
  record(params: {
    auth: AuthContext;
    action: string;
    resource: string;
    outcome: AuditEvent['outcome'];
    detail?: string;
  }): Promise<void>;
}

export function createAuditWriter(repository: CaseRepository, logger: Logger, clock: () => Date = () => new Date()): AuditWriter {
  return {
    async record({ auth, action, resource, outcome, detail }) {
      const now = clock();
      const event: AuditEvent = {
        auditId: newAuditId(now),
        day: dayKey(now),
        action,
        actorId: auth.userId,
        actorRole: auth.role,
        resource,
        outcome,
        requestId: auth.requestId,
        detail: detail?.slice(0, 300),
        createdAt: isoNow(now),
      };
      try {
        await repository.putAudit(event);
      } catch (error) {
        logger.error('audit write failed', { error, action, resource, outcome });
      }
    },
  };
}
