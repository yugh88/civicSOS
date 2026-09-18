'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReportFlow, ReportFlowSkeleton } from '@/components/ReportFlow';
import type { CategoryId } from '@/lib/types';

/**
 * Report a problem — the primary journey, and where the demo starts.
 *
 * A `?category=` parameter lets the home page's category cards pre-select a
 * category without making the citizen fill a form first.
 */

const VALID_CATEGORIES = new Set([
  'ROAD_DAMAGE',
  'GARBAGE_SANITATION',
  'STREETLIGHT',
  'WATER_SEWERAGE',
  'PUBLIC_SAFETY_HAZARD',
  'OTHER',
]);

function ReportContent() {
  const params = useSearchParams();
  const requested = params.get('category');
  // Validated against the known set: a URL parameter is untrusted input, even
  // one that only selects a chip.
  const initialCategory = requested && VALID_CATEGORIES.has(requested) ? (requested as CategoryId) : undefined;

  return <ReportFlow initialCategory={initialCategory} />;
}

export default function ReportPage() {
  return (
    <Suspense fallback={<ReportFlowSkeleton />}>
      <ReportContent />
    </Suspense>
  );
}
