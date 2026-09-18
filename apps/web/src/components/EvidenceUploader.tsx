'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/auth';
import {
  ACCEPT_ATTRIBUTE,
  MAX_EVIDENCE_BYTES,
  formatBytes,
  uploadEvidence,
  validateEvidenceFile,
  type UploadPhase,
} from '@/lib/evidence-upload';
import { formatDateTime } from '@/lib/format';
import type { EvidenceViewResponse } from '@/lib/types';
import { Alert, Button, EmptyState, Spinner } from './ui';

/**
 * Evidence upload.
 *
 * Three steps, matching the API: reserve a slot, PUT the file straight to
 * storage with the pre-signed URL, then confirm. The file bytes never pass
 * through our API — that keeps us inside the free tier and means an
 * interrupted upload leaves no half-recorded evidence behind, because nothing
 * is counted until the confirm step verifies the object landed.
 */

type Phase = 'idle' | UploadPhase;

export function EvidenceUploader({
  caseId,
  canUpload,
  onUploaded,
}: {
  caseId: string;
  canUpload: boolean;
  onUploaded?: () => void;
}) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceViewResponse['evidence']>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const result = await api<EvidenceViewResponse>(`/cases/${caseId}/evidence`);
      setItems(result.evidence);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load your files.');
    } finally {
      setLoading(false);
    }
  }, [api, caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      setError(undefined);

      // Checked here for an instant, friendly message; the server enforces the
      // same limits again and is the actual authority.
      const problem = validateEvidenceFile(file);
      if (problem) {
        setError(problem);
        return;
      }

      try {
        await uploadEvidence(api, caseId, file, setPhase);
        await refresh();
        onUploaded?.();
      } catch (caught) {
        if (caught instanceof ApiError) setError(caught.message);
        else setError('That upload did not go through. Please try again.');
      } finally {
        setPhase('idle');
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [api, caseId, onUploaded, refresh],
  );

  const busy = phase !== 'idle';
  const phaseLabel: Record<Phase, string> = {
    idle: '',
    reserving: 'Preparing the upload…',
    uploading: 'Uploading your file…',
    confirming: 'Checking it arrived…',
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert tone="bad" title="Upload problem">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner />
          Loading your files…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="📷"
          title="No photos yet"
          description="A clear, wide photo showing a nearby landmark is the single most useful thing you can attach."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.evidenceId} className="overflow-hidden rounded-xl border border-line bg-surface-soft">
              {item.contentType.startsWith('image/') ? (
                // Plain <img>: these are short-lived signed URLs, which the
                // Next.js image optimizer cannot cache or re-fetch anyway.
                <img
                  src={item.downloadUrl}
                  alt={item.label ? `Evidence: ${item.label}` : 'Evidence photo'}
                  className="h-40 w-full bg-surface-sunken object-cover"
                  loading="lazy"
                />
              ) : (
                <div aria-hidden="true" className="flex h-40 items-center justify-center bg-surface-sunken text-4xl">
                  📄
                </div>
              )}
              <div className="p-3">
                <p className="truncate text-sm font-medium text-ink">{item.label ?? 'Attachment'}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {formatBytes(item.sizeBytes)} · {formatDateTime(item.uploadedAt)}
                </p>
                <a
                  href={item.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
                >
                  Open full size
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div>
          <input
            ref={inputRef}
            id={`evidence-${caseId}`}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            onClick={() => inputRef.current?.click()}
            aria-describedby={`evidence-hint-${caseId}`}
          >
            {busy ? phaseLabel[phase] : 'Add a photo or PDF'}
          </Button>
          <p id={`evidence-hint-${caseId}`} className="mt-2 text-xs text-ink-muted">
            JPEG, PNG, WebP, HEIC or PDF, up to {formatBytes(MAX_EVIDENCE_BYTES)}. Files are private to you and are served only
            through short-lived links.
          </p>
          {/* Progress is announced for screen reader users, not just shown. */}
          <span role="status" aria-live="polite" className="sr-only">
            {busy ? phaseLabel[phase] : ''}
          </span>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">This case is closed, so no more files can be added.</p>
      )}
    </div>
  );
}
