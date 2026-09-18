import type { ApiErrorBody, HttpResponse } from './types.js';
import { AppError, isAppError } from '../domain/errors.js';
import type { Logger } from '../util/logger.js';

/**
 * Response construction and error mapping.
 *
 * Two guarantees enforced here: every response carries the security headers,
 * and no internal error detail ever reaches a client. Unexpected throwables
 * become a generic 500 with a request id the user can quote.
 */

/**
 * Security headers applied to every API response.
 *
 * The API returns only JSON, so the CSP is maximally restrictive — it exists to
 * neutralize any attempt to get a browser to render an API response as a
 * document. The page CSP lives in the Next.js config.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  // Responses are per-user; caching them anywhere shared would be a data leak.
  'cache-control': 'no-store',
};

export function jsonResponse(status: number, payload: unknown, extraHeaders: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

export function noContentResponse(extraHeaders: Record<string, string> = {}): HttpResponse {
  return { status: 204, headers: { ...SECURITY_HEADERS, ...extraHeaders }, body: '' };
}

/**
 * CORS.
 *
 * An explicit allow-list, never `*`: the API is credentialed, and a wildcard
 * with credentials is both invalid and unsafe. Origins come from configuration
 * so the deployed frontend origin is the only one accepted in production.
 */
export function corsHeaders(origin: string | undefined, allowedOrigins: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    vary: 'Origin',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-request-id,x-idempotency-key',
    'access-control-max-age': '600',
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

export function errorResponse(
  error: unknown,
  requestId: string,
  logger: Logger,
  extraHeaders: Record<string, string> = {},
): HttpResponse {
  const appError = isAppError(error) ? error : undefined;

  if (!appError) {
    // Unknown failure: log everything, return nothing.
    logger.error('unhandled error', { error, requestId });
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Please try again.',
        requestId,
      },
    };
    return jsonResponse(500, body, extraHeaders);
  }

  if (appError.status >= 500) {
    logger.error('request failed', { error: appError, requestId, ...appError.logContext });
  } else {
    logger.warn('request rejected', {
      requestId,
      code: appError.code,
      status: appError.status,
      ...appError.logContext,
    });
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.publicMessage,
      issues: appError.issues.length > 0 ? appError.issues : undefined,
      requestId,
    },
  };
  return jsonResponse(appError.status, body, extraHeaders);
}

/** Converts a zod error into our field-issue format. */
export function zodIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): AppError {
  return AppError.validation(
    error.issues.slice(0, 10).map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message,
    })),
  );
}
