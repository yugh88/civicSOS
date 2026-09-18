import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage, UploadTarget } from '@civicsos/core';

/**
 * S3 evidence storage.
 *
 * The bucket is private: no public access, no ACLs, no website hosting, and
 * server-side encryption on. Nothing is ever served from it directly.
 *
 * Uploads are pre-signed PUTs that go straight from the browser to S3. That is
 * both a cost decision (file bytes never pass through Lambda or API Gateway, and
 * API Gateway has a 10 MB payload ceiling anyway) and a security one: the
 * signature covers the content type and length, so a client cannot upload
 * something other than the file it declared.
 */

export interface S3StorageOptions {
  bucket: string;
  client?: S3Client;
  /** Default lifetime for pre-signed URLs. Short on purpose. */
  defaultExpirySeconds?: number;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultExpiry: number;

  constructor(options: S3StorageOptions) {
    this.client = options.client ?? new S3Client({});
    this.bucket = options.bucket;
    this.defaultExpiry = options.defaultExpirySeconds ?? 300;
  }

  async createUploadUrl(params: {
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<UploadTarget> {
    const expiresIn = params.expiresInSeconds ?? this.defaultExpiry;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.storageKey,
      ContentType: params.contentType,
      // Signing the length pins the upload to the size the server approved.
      ContentLength: params.sizeBytes,
      ServerSideEncryption: 'AES256',
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });

    return {
      url,
      // The client must send exactly these headers or the signature fails.
      headers: {
        'content-type': params.contentType,
        'content-length': String(params.sizeBytes),
        'x-amz-server-side-encryption': 'AES256',
      },
      storageKey: params.storageKey,
      expiresInSeconds: expiresIn,
    };
  }

  async createDownloadUrl(params: { storageKey: string; expiresInSeconds?: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: params.storageKey }),
      { expiresIn: params.expiresInSeconds ?? this.defaultExpiry },
    );
  }

  async headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      return { exists: true, sizeBytes: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
      // A missing object is an expected outcome of the confirm step, not an error.
      if (isNotFound(error)) return { exists: false };
      throw error;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name: unknown }).name) : '';
  const status = '$metadata' in error ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
