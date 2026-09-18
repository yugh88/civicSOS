'use client';

import { useEffect } from 'react';
import { Alert, Button } from '@/components/ui';

/**
 * Route-level error boundary.
 *
 * Shows a recoverable message and a retry, never the underlying error text — a
 * stack trace or an internal message is of no use to a citizen and could leak
 * implementation detail.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is the only handle we surface; it correlates with server logs.
    console.error('Route error', error.digest);
  }, [error]);

  return (
    <div className="space-y-4">
      <Alert tone="bad" title="Something went wrong on this page">
        <p>We could not load this. Trying again usually works.</p>
        {error.digest ? <p className="mt-2 text-xs text-ink-muted">Reference: {error.digest}</p> : null}
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
