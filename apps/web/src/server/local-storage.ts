import 'server-only';
import type { ObjectStorage, UploadTarget } from '@civicsos/core';

/**
 * Local development object storage.
 *
 * Keeps evidence bytes in process memory and hands out URLs pointing at this
 * app's own `/api/local-storage` route, so the three-step upload flow (reserve →
 * PUT → confirm) genuinely works offline with no S3 bucket and no AWS account.
 *
 * It mirrors the real adapter's contract closely — signed-looking URLs with an
 * expiry that is actually enforced, a content-type and size that are actually
 * checked — so a bug in the upload flow shows up here rather than only after
 * deployment.
 */

interface StoredObject {
  bytes?: Uint8Array;
  contentType: string;
  declaredSize: number;
}

interface Grant {
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  expiresAt: number;
  mode: 'PUT' | 'GET';
}

/**
 * Held on `globalThis`, not in module scope.
 *
 * The upload route and the API route are separate Next.js route modules and are
 * not guaranteed to share a module instance, so a module-level Map would leave
 * the PUT handler unable to see the grant the API just issued.
 */
const globalState = globalThis as typeof globalThis & {
  __civicsosObjects?: Map<string, StoredObject>;
  __civicsosGrants?: Map<string, Grant>;
};

globalState.__civicsosObjects ??= new Map<string, StoredObject>();
globalState.__civicsosGrants ??= new Map<string, Grant>();

const objects = globalState.__civicsosObjects;
const grants = globalState.__civicsosGrants;

function newGrantId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly basePath = '/api/local-storage') {}

  async createUploadUrl(params: {
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<UploadTarget> {
    const expiresInSeconds = params.expiresInSeconds ?? 300;
    const grantId = newGrantId();
    grants.set(grantId, {
      storageKey: params.storageKey,
      contentType: params.contentType,
      sizeBytes: params.sizeBytes,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      mode: 'PUT',
    });

    return {
      url: `${this.basePath}?grant=${grantId}`,
      headers: { 'content-type': params.contentType },
      storageKey: params.storageKey,
      expiresInSeconds,
    };
  }

  async createDownloadUrl(params: { storageKey: string; expiresInSeconds?: number }): Promise<string> {
    const expiresInSeconds = params.expiresInSeconds ?? 300;
    const grantId = newGrantId();
    const existing = objects.get(params.storageKey);
    grants.set(grantId, {
      storageKey: params.storageKey,
      contentType: existing?.contentType ?? 'application/octet-stream',
      sizeBytes: existing?.declaredSize ?? 0,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      mode: 'GET',
    });
    return `${this.basePath}?grant=${grantId}`;
  }

  async headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    const object = objects.get(storageKey);
    // Only a completed PUT counts as existing, exactly as with S3.
    if (!object?.bytes) return { exists: false };
    return { exists: true, sizeBytes: object.bytes.byteLength, contentType: object.contentType };
  }

  async deleteObject(storageKey: string): Promise<void> {
    objects.delete(storageKey);
  }
}

export interface GrantResolution {
  ok: boolean;
  status: number;
  message?: string;
  grant?: Grant;
}

/** Validates a grant the way a pre-signed URL's signature and expiry would. */
export function resolveGrant(grantId: string | null, mode: 'PUT' | 'GET'): GrantResolution {
  if (!grantId) return { ok: false, status: 400, message: 'Missing upload grant.' };
  const grant = grants.get(grantId);
  if (!grant) return { ok: false, status: 403, message: 'That upload link is not valid.' };
  if (grant.mode !== mode) return { ok: false, status: 403, message: 'That link cannot be used this way.' };
  if (grant.expiresAt <= Date.now()) {
    grants.delete(grantId);
    return { ok: false, status: 403, message: 'That upload link has expired.' };
  }
  return { ok: true, status: 200, grant };
}

export function storeLocalObject(grant: Grant, bytes: Uint8Array): void {
  objects.set(grant.storageKey, {
    bytes,
    contentType: grant.contentType,
    declaredSize: grant.sizeBytes,
  });
}

export function readLocalObject(storageKey: string): StoredObject | undefined {
  return objects.get(storageKey);
}

export function consumeGrant(grantId: string): void {
  grants.delete(grantId);
}
