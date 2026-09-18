/**
 * DynamoDB single-table key design.
 *
 * One table, one set of keys, defined here and nowhere else. Every access
 * pattern the application needs is a Query or a GetItem — there is no Scan in
 * any normal flow, which is what keeps the table inside the free tier and keeps
 * latency flat as data grows.
 *
 * Entity layout (PK / SK):
 *   Case          CASE#<caseId>        / META
 *   CaseEvent     CASE#<caseId>        / EVT#<eventId>
 *   Evidence      CASE#<caseId>        / EVD#<evidenceId>
 *   User          USER#<userId>        / PROFILE
 *   Notification  USER#<userId>        / NTF#<notificationId>
 *   Idempotency   IDEMP#<owner>#<key>  / META
 *   Audit         AUDIT#<YYYY-MM-DD>   / <auditId>
 *   PointsEntry   USER#<userId>        / PTS#<entryId>
 *   PointsDedupe  USER#<userId>        / PTSKEY#<dedupeKey>
 *   Redemption    USER#<userId>        / RDM#<redemptionId>
 *
 * Indexes:
 *   gsi1 byOwner     OWNER#<ownerId>      / <createdAt>#<caseId>
 *                    -> "my cases", newest first
 *   gsi2 byStatus    STATUS#<status>      / <createdAt>#<caseId>
 *                    -> staff queues and admin aggregates
 *   gsi3 byFollowUp  FOLLOWUP#<dueDay>    / <followUpAt>#<caseId>
 *                    -> the daily reminder sweep. Sparse (only open cases with
 *                       a follow-up date) and partitioned by due *day*, so the
 *                       sweep never hits a single hot partition and never scans.
 */

export const TABLE_INDEXES = {
  byOwner: 'gsi1',
  byStatus: 'gsi2',
  byFollowUp: 'gsi3',
} as const;

export const casePk = (caseId: string) => `CASE#${caseId}`;
export const CASE_SK = 'META';
export const caseEventSk = (eventId: string) => `EVT#${eventId}`;
export const evidenceSk = (evidenceId: string) => `EVD#${evidenceId}`;

export const userPk = (userId: string) => `USER#${userId}`;
export const USER_SK = 'PROFILE';
export const notificationSk = (notificationId: string) => `NTF#${notificationId}`;

export const pointsSk = (entryId: string) => `PTS#${entryId}`;
/**
 * Marker row that makes a points award idempotent. Written conditionally in the
 * same transaction as the ledger entry, so a replayed award writes neither.
 */
export const pointsDedupeSk = (dedupeKey: string) => `PTSKEY#${dedupeKey}`;
export const redemptionSk = (redemptionId: string) => `RDM#${redemptionId}`;

export const idempotencyPk = (ownerId: string, key: string) => `IDEMP#${ownerId}#${key}`;
export const auditPk = (day: string) => `AUDIT#${day}`;

export const ownerGsiPk = (ownerId: string) => `OWNER#${ownerId}`;
export const statusGsiPk = (status: string) => `STATUS#${status}`;
export const followUpGsiPk = (dueDay: string) => `FOLLOWUP#${dueDay}`;

/** Sort key that orders cases newest-first when the query runs backwards. */
export const caseSortKey = (createdAt: string, caseId: string) => `${createdAt}#${caseId}`;
export const followUpSortKey = (followUpAt: string, caseId: string) => `${followUpAt}#${caseId}`;

/**
 * How far back the reminder sweep looks.
 *
 * The sweep runs daily and pushes each case's follow-up date forward, so a case
 * cannot normally sit more than a day past due. The window covers a fortnight of
 * missed schedules without ever needing a scan.
 */
export const FOLLOW_UP_LOOKBACK_DAYS = 14;
