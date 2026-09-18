/**
 * Structured JSON logging.
 *
 * One JSON object per line so CloudWatch Logs Insights can query fields
 * directly. Every value passes through `redactForLogs`, so a careless
 * `logger.info('x', { case: caseRecord })` cannot leak a citizen's email.
 */

import { redactForLogs } from './sanitize.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that always emits the given fields. */
  child(fields: LogFields): Logger;
  /** Times an operation and logs its duration and outcome. */
  timed<T>(operation: string, fn: () => Promise<T>, fields?: LogFields): Promise<T>;
}

function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      // Messages can contain user text, so they are redacted like any other field.
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 6).join('\n'),
    };
  }
  return { errorName: 'NonError', errorMessage: String(error).slice(0, 200) };
}

export function createLogger(base: LogFields = {}, minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const payload = redactForLogs({ ...base, ...fields }) as LogFields;
    const line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      service: 'civicsos',
      ...payload,
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  const logger: Logger = {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => {
      if (fields && 'error' in fields) {
        const { error, ...rest } = fields;
        emit('error', message, { ...rest, ...serializeError(error) });
      } else {
        emit('error', message, fields);
      }
    },
    child: (fields) => createLogger({ ...base, ...fields }, minLevel),
    async timed(operation, fn, fields) {
      const startedAt = Date.now();
      try {
        const result = await fn();
        emit('info', operation + ' ok', { ...fields, operation, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        emit('error', operation + ' failed', {
          ...fields,
          operation,
          durationMs: Date.now() - startedAt,
          ...serializeError(error),
        });
        throw error;
      }
    },
  };

  return logger;
}

function envLogLevel(): LogLevel {
  const raw = typeof process !== 'undefined' ? process.env.LOG_LEVEL : undefined;
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

/** Default logger. Level is configurable so local dev can turn on debug output. */
export const logger = createLogger({}, envLogLevel());
