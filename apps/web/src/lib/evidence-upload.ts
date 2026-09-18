import { ApiError, uploadToSignedUrl } from './api';
import type { UploadReservationResponse } from './types';

/**
 * Evidence upload, in one place.
 *
 * The three-step flow the API defines — reserve a slot, PUT straight to storage
 * with the pre-signed URL, confirm the object landed — is used from two screens
 * now (the case detail uploader, and the report flow once a case exists), so it
 * lives here rather than being written twice.
 *
 * No backend change: the report flow holds the chosen files in memory and
 * replays them through this exact API after the case is created.
 */

export const ACCEPTED_EVIDENCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_EVIDENCE_TYPES.join(',');

/** Mirrors the server's caps so the UI can fail fast with a friendly message. */
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const MAX_EVIDENCE_PER_CASE = 6;

export type UploadPhase = 'reserving' | 'uploading' | 'confirming';

type ApiCall = <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown }) => Promise<T>;

/** Client-side validation. The server enforces the same limits again. */
export function validateEvidenceFile(file: File): string | undefined {
  if (!(ACCEPTED_EVIDENCE_TYPES as readonly string[]).includes(file.type)) {
    return 'Please use a JPEG, PNG, WebP or HEIC photo, or a PDF.';
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `That file is ${formatBytes(file.size)}. Please use one under ${formatBytes(MAX_EVIDENCE_BYTES)}.`;
  }
  if (file.size === 0) return 'That file appears to be empty.';
  return undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uploads one file to a case. Resolves with the evidence id.
 *
 * `onPhase` lets the caller narrate what is happening — the three steps have
 * genuinely different durations, and "uploading" sitting on screen while we are
 * actually verifying the object reads as a stall.
 */
export async function uploadEvidence(
  api: ApiCall,
  caseId: string,
  file: File,
  onPhase?: (phase: UploadPhase) => void,
): Promise<string> {
  const problem = validateEvidenceFile(file);
  if (problem) throw new ApiError(422, 'VALIDATION_FAILED', problem);

  onPhase?.('reserving');
  const reservation = await api<UploadReservationResponse>(`/cases/${caseId}/evidence`, {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      label: file.name.replace(/\.[^.]+$/, '').slice(0, 120),
    },
  });

  onPhase?.('uploading');
  await uploadToSignedUrl(reservation.uploadUrl, reservation.headers, file);

  onPhase?.('confirming');
  await api(`/cases/${caseId}/evidence/confirm`, {
    method: 'POST',
    body: { evidenceId: reservation.evidenceId },
  });

  return reservation.evidenceId;
}

export interface BulkUploadResult {
  uploaded: number;
  failed: number;
  /** First error message, for a single clear line rather than a list. */
  firstError?: string;
}

/**
 * Uploads several files in sequence.
 *
 * Sequential rather than parallel: the per-case cap is checked server-side on
 * each reservation, and firing six concurrent reservations would race that
 * check. One at a time is also gentler on a phone connection.
 */
export async function uploadEvidenceBatch(
  api: ApiCall,
  caseId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<BulkUploadResult> {
  let uploaded = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const [index, file] of files.entries()) {
    try {
      await uploadEvidence(api, caseId, file);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      if (!firstError) {
        firstError = error instanceof Error ? error.message : 'One of your photos could not be uploaded.';
      }
    }
    onProgress?.(index + 1, files.length);
  }

  return { uploaded, failed, firstError };
}
