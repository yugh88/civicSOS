/**
 * Application error taxonomy.
 *
 * Every error crossing the HTTP boundary is an `AppError` so that responses have
 * a consistent shape and internal details never reach the client. Unexpected
 * throwables are mapped to a generic 500 by the router.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Field-level validation detail. Safe to return to the client. */
export interface FieldIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Message intended for end users — no internals, no stack, no PII. */
  readonly publicMessage: string;
  readonly issues: FieldIssue[];
  /** Internal-only context for structured logs. Never serialized to clients. */
  readonly logContext?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    publicMessage: string,
    options: { issues?: FieldIssue[]; logContext?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(`${code}: ${publicMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.publicMessage = publicMessage;
    this.issues = options.issues ?? [];
    this.logContext = options.logContext;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  static badRequest(message: string, issues?: FieldIssue[]): AppError {
    return new AppError('BAD_REQUEST', message, { issues });
  }

  static validation(issues: FieldIssue[]): AppError {
    return new AppError('VALIDATION_FAILED', 'Some details need fixing before we can continue.', { issues });
  }

  static unauthenticated(message = 'Please sign in to continue.'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }

  static forbidden(message = "You don't have access to this."): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static notFound(message = "We couldn't find that."): AppError {
    return new AppError('NOT_FOUND', message);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }

  static tooLarge(message = 'That file or request is too large.'): AppError {
    return new AppError('PAYLOAD_TOO_LARGE', message);
  }

  static rateLimited(message = 'Too many requests. Please wait a moment and try again.'): AppError {
    return new AppError('RATE_LIMITED', message);
  }

  static internal(logContext?: Record<string, unknown>, cause?: unknown): AppError {
    return new AppError('INTERNAL', 'Something went wrong on our side. Please try again.', {
      logContext,
      cause,
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
