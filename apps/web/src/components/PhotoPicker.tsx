'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_CASE,
  formatBytes,
  validateEvidenceFile,
} from '@/lib/evidence-upload';
import { IconCamera, IconClose, IconDocument } from './icons';

/**
 * Photo picker for the report flow.
 *
 * The citizen chooses photos *before* the case exists, so this component holds
 * the `File` objects in memory and previews them with object URLs. The report
 * flow uploads them through the existing three-step evidence API once the case
 * has been created — no new endpoint, no change to the upload contract.
 *
 * `capture` is deliberately not set on the input: on a phone that would force
 * the camera and hide the gallery, and most people are reporting something they
 * photographed a minute ago.
 */

export interface PickedPhoto {
  id: string;
  file: File;
  /** Object URL. Revoked when the photo is removed or the component unmounts. */
  previewUrl: string;
}

export function PhotoPicker({
  photos,
  onChange,
  disabled = false,
  max = MAX_EVIDENCE_PER_CASE,
}: {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  /** How many thumbnails to render before collapsing into a "+N" tile. */
  const visibleLimit = 3;

  // Object URLs are a real allocation; release them when this unmounts.
  useEffect(() => {
    return () => {
      for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    };
    // Intentionally on unmount only — removal revokes its own URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setError(undefined);

      const room = max - photos.length;
      if (room <= 0) {
        setError(`You can attach up to ${max} files.`);
        return;
      }

      const incoming = Array.from(fileList);
      const accepted: PickedPhoto[] = [];
      let rejection: string | undefined;

      for (const file of incoming.slice(0, room)) {
        const problem = validateEvidenceFile(file);
        if (problem) {
          rejection ??= problem;
          continue;
        }
        // Same name and size twice is almost always a double-selection.
        if (photos.some((photo) => photo.file.name === file.name && photo.file.size === file.size)) continue;
        accepted.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (incoming.length > room) {
        rejection ??= `Only ${room} more file${room === 1 ? '' : 's'} can be attached.`;
      }
      if (rejection) setError(rejection);
      if (accepted.length > 0) onChange([...photos, ...accepted]);
    },
    [max, onChange, photos],
  );

  const remove = useCallback(
    (id: string) => {
      const target = photos.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      onChange(photos.filter((photo) => photo.id !== id));
      setError(undefined);
    },
    [onChange, photos],
  );

  const shown = photos.slice(0, visibleLimit);
  const overflow = photos.length - shown.length;
  const full = photos.length >= max;

  return (
    <div className="space-y-2.5">
      <input
        ref={inputRef}
        id="report-photos"
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          addFiles(event.target.files);
          // Reset so re-picking the same file fires a change event.
          event.target.value = '';
        }}
      />

      <div
        onDragOver={(event) => {
          if (disabled || full) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled || full) return;
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`flex flex-wrap gap-2.5 rounded-xl transition-colors ${
          dragging ? 'bg-accent-soft ring-2 ring-accent-line' : ''
        }`}
      >
        {/* Upload tile ------------------------------------------------ */}
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => inputRef.current?.click()}
          aria-describedby="report-photos-hint"
          className="flex h-[74px] w-[74px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-accent-line bg-accent-soft/50 text-accent transition-colors duration-150 hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface-sunken disabled:text-ink-faint"
        >
          <IconCamera className="h-5 w-5" />
          <span className="text-[11px] font-medium">Upload</span>
        </button>

        {/* Thumbnails -------------------------------------------------- */}
        {shown.map((photo) => {
          const isPdf = photo.file.type === 'application/pdf';
          return (
            <div key={photo.id} className="group relative h-[74px] w-[74px] shrink-0">
              <div className="h-full w-full overflow-hidden rounded-xl bg-surface-sunken ring-1 ring-line">
                {isPdf ? (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-muted">
                    <IconDocument className="h-6 w-6" />
                    <span className="px-1 text-[10px] leading-tight">PDF</span>
                  </span>
                ) : (
                  <img
                    src={photo.previewUrl}
                    alt={`Selected: ${photo.file.name}`}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(photo.id)}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white shadow-card transition-transform hover:scale-105 disabled:opacity-50"
              >
                <IconClose className="h-3.5 w-3.5" />
                <span className="sr-only">Remove {photo.file.name}</span>
              </button>
            </div>
          );
        })}

        {/* Overflow ---------------------------------------------------- */}
        {overflow > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex h-[74px] w-[74px] shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-sm font-semibold text-ink-soft ring-1 ring-line transition-colors hover:bg-line"
          >
            +{overflow}
            <span className="sr-only"> more photo{overflow === 1 ? '' : 's'} attached</span>
          </button>
        ) : null}
      </div>

      <p id="report-photos-hint" className="text-xs leading-relaxed text-ink-muted">
        {photos.length > 0 ? (
          <>
            {photos.length} of {max} attached · they upload once your case is created.
          </>
        ) : (
          <>
            A wide photo showing a nearby landmark helps most. Up to {max} files, {formatBytes(MAX_EVIDENCE_BYTES)}{' '}
            each.
          </>
        )}
      </p>

      {error ? (
        <p role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
