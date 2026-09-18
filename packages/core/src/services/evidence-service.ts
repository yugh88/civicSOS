import type { AuthContext, EvidenceItem } from '../domain/types.js';
import type { EvidenceUploadRequest } from '../schemas/requests.js';
import type { ServiceContext } from './context.js';
import { AppError } from '../domain/errors.js';
import { newCaseEventId, newEvidenceId } from '../domain/ids.js';
import { assertCanAccessEvidence, assertCanWriteCase } from './authorization.js';
import { isoNow } from '../util/time.js';
import { MAX_EVIDENCE_BYTES } from '../schemas/common.js';
import { PointsService } from './points-service.js';

/**
 * Evidence service.
 *
 * The bucket is private with no public access and no website hosting. Uploads
 * go straight from the browser to S3 with a short-lived pre-signed PUT, so file
 * bytes never pass through Lambda (which keeps us inside the free tier and
 * avoids API Gateway's payload limit). Downloads are equally short-lived
 * pre-signed GETs, issued only after the case-level authorization check.
 *
 * The flow is deliberately three-step — reserve, upload, confirm — so we never
 * record evidence that does not actually exist in the bucket.
 */

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** Hard cap so one case cannot be used as free object storage. */
export const MAX_EVIDENCE_PER_CASE = 6;

export interface UploadReservation {
  evidenceId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
}

export interface EvidenceView extends Omit<EvidenceItem, 'storageKey' | 'uploadedBy'> {
  /** Pre-signed GET URL, valid for `signedUrlTtlSeconds`. */
  downloadUrl: string;
}

export class EvidenceService {
  private readonly points: PointsService;

  constructor(private readonly ctx: ServiceContext) {
    this.points = new PointsService(ctx);
  }

  /** Step 1: reserve a slot and hand back a pre-signed PUT. */
  async reserveUpload(auth: AuthContext, caseId: string, request: EvidenceUploadRequest): Promise<UploadReservation> {
    const record = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));

    const existing = await this.ctx.repository.listEvidence(caseId);
    if (existing.length >= MAX_EVIDENCE_PER_CASE) {
      throw AppError.conflict(`You can attach up to ${MAX_EVIDENCE_PER_CASE} files to a case.`);
    }
    if (request.sizeBytes > MAX_EVIDENCE_BYTES) throw AppError.tooLarge();

    const now = this.ctx.clock.now();
    const evidenceId = newEvidenceId(now);
    const extension = EXTENSION_BY_TYPE[request.contentType] ?? 'bin';
    // Key derived server-side from ids only — the client's filename never
    // reaches the object key, so it cannot traverse paths or collide.
    const storageKey = `cases/${record.ownerId}/${caseId}/${evidenceId}.${extension}`;

    const target = await this.ctx.storage.createUploadUrl({
      storageKey,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      expiresInSeconds: this.ctx.config.signedUrlTtlSeconds,
    });

    await this.ctx.repository.putEvidence({
      evidenceId,
      caseId,
      storageKey,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      label: request.label,
      uploadedAt: isoNow(now),
      uploadedBy: auth.userId,
      // Unconfirmed until we have verified the object exists.
      confirmed: false,
    });

    await this.ctx.audit.record({
      auth,
      action: 'EVIDENCE_RESERVE',
      resource: `case/${caseId}/evidence/${evidenceId}`,
      outcome: 'ALLOW',
      detail: request.contentType,
    });

    return {
      evidenceId,
      uploadUrl: target.url,
      headers: target.headers,
      expiresInSeconds: target.expiresInSeconds,
      maxBytes: MAX_EVIDENCE_BYTES,
    };
  }

  /** Step 3: verify the object landed, then count it towards the case. */
  async confirmUpload(auth: AuthContext, caseId: string, evidenceId: string): Promise<EvidenceItem> {
    const record = assertCanWriteCase(auth, await this.ctx.repository.getCase(caseId));
    const item = await this.ctx.repository.getEvidence(caseId, evidenceId);
    if (!item) throw AppError.notFound('We couldn’t find that upload.');
    if (item.confirmed) return item;

    const head = await this.ctx.storage.headObject(item.storageKey);
    if (!head.exists) {
      throw AppError.conflict('That file has not finished uploading yet. Please try the upload again.');
    }
    if (head.sizeBytes !== undefined && head.sizeBytes > MAX_EVIDENCE_BYTES) {
      // Belt and braces: the pre-signed policy already caps size, but we never
      // trust that an object matches what was reserved.
      await this.ctx.storage.deleteObject(item.storageKey);
      throw AppError.tooLarge();
    }

    const confirmed: EvidenceItem = {
      ...item,
      confirmed: true,
      sizeBytes: head.sizeBytes ?? item.sizeBytes,
    };
    await this.ctx.repository.putEvidence(confirmed);

    const evidence = await this.ctx.repository.listEvidence(caseId);
    const confirmedCount = evidence.filter((entry) => entry.confirmed).length;
    await this.ctx.repository.updateCase({
      ...record,
      evidenceCount: confirmedCount,
      updatedAt: isoNow(this.ctx.clock.now()),
    });

    const now = this.ctx.clock.now();
    await this.ctx.repository.appendEvent({
      caseId,
      eventId: newCaseEventId(now),
      type: 'EVIDENCE_ADDED',
      message: item.label ? `Evidence added: ${item.label}` : 'Evidence added.',
      actor: auth.userId,
      createdAt: isoNow(now),
    });

    await this.ctx.events.publish({
      type: 'EvidenceAdded',
      caseId,
      ownerId: record.ownerId,
      occurredAt: isoNow(now),
      detail: { evidenceCount: confirmedCount },
    });

    // Once per case, however many files are attached: the bonus is for
    // providing evidence at all, not for uploading repeatedly.
    await this.points.awardForEvidence(record);

    await this.ctx.audit.record({
      auth,
      action: 'EVIDENCE_CONFIRM',
      resource: `case/${caseId}/evidence/${evidenceId}`,
      outcome: 'ALLOW',
    });

    return confirmed;
  }

  /** Lists evidence with fresh short-lived download URLs. */
  async list(auth: AuthContext, caseId: string): Promise<EvidenceView[]> {
    assertCanAccessEvidence(auth, await this.ctx.repository.getCase(caseId));
    const items = await this.ctx.repository.listEvidence(caseId);

    const views = await Promise.all(
      items
        .filter((item) => item.confirmed)
        .map(async (item) => {
          const { storageKey, uploadedBy, ...rest } = item;
          return {
            ...rest,
            downloadUrl: await this.ctx.storage.createDownloadUrl({
              storageKey,
              expiresInSeconds: this.ctx.config.signedUrlTtlSeconds,
            }),
          };
        }),
    );

    await this.ctx.audit.record({
      auth,
      action: 'EVIDENCE_LIST',
      resource: `case/${caseId}/evidence`,
      outcome: 'ALLOW',
      detail: `count=${views.length}`,
    });

    return views;
  }
}
