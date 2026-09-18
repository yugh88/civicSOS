import type { AuthResolver, HttpRequest, HttpResponse, RouteContext, RouteDefinition } from './types.js';
import { corsHeaders, errorResponse, jsonResponse } from './responses.js';
import { AppError } from '../domain/errors.js';
import { newRequestId } from '../domain/ids.js';
import { MAX_REQUEST_BYTES } from '../schemas/common.js';
import type { Logger } from '../util/logger.js';

/**
 * Minimal router.
 *
 * Handles matching, authentication, body-size limits, JSON parsing, CORS,
 * security headers and error mapping — the cross-cutting concerns every handler
 * would otherwise repeat and eventually get wrong. Roughly 150 lines instead of
 * a framework, because the Lambda bundle size and cold-start time are real
 * costs on the free tier.
 */

export interface RouterOptions {
  routes: RouteDefinition[];
  auth: AuthResolver;
  logger: Logger;
  /** Exact origins allowed to call the API with credentials. */
  allowedOrigins: string[];
}

interface CompiledRoute extends RouteDefinition {
  segments: string[];
  paramNames: string[];
}

function compile(route: RouteDefinition): CompiledRoute {
  const segments = route.pattern.split('/').filter((segment) => segment.length > 0);
  return {
    ...route,
    segments,
    paramNames: segments.filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1)),
  };
}

function normalizePath(path: string): string[] {
  // Strip a query string if the caller passed a full URL path, and drop the
  // API Gateway stage prefix so local and deployed paths match.
  const [pathOnly] = path.split('?');
  return (pathOnly ?? '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

/** Segment-only match, ignoring the HTTP method. */
function matchPath(route: CompiledRoute, segments: string[]): Record<string, string> | undefined {
  if (route.segments.length !== segments.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index]!;
    const actual = segments[index]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = actual;
    else if (expected !== actual) return undefined;
  }
  return params;
}

function match(route: CompiledRoute, method: string, segments: string[]): Record<string, string> | undefined {
  if (route.method !== method) return undefined;
  return matchPath(route, segments);
}

export interface Router {
  handle(request: HttpRequest): Promise<HttpResponse>;
  readonly routes: RouteDefinition[];
}

export function createRouter(options: RouterOptions): Router {
  const compiled = options.routes.map(compile);

  return {
    routes: options.routes,

    async handle(request: HttpRequest): Promise<HttpResponse> {
      // Correlation id: honour an inbound one so the browser, API Gateway and
      // Lambda logs can be stitched together, but never trust its shape.
      const inbound = request.headers['x-request-id'];
      const requestId =
        typeof inbound === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(inbound) ? inbound : newRequestId();
      const origin = request.headers.origin;
      const cors = corsHeaders(origin, options.allowedOrigins);
      const logger = options.logger.child({ requestId });

      const method = request.method.toUpperCase();
      const segments = normalizePath(request.path);

      if (method === 'OPTIONS') {
        return { status: 204, headers: { ...cors }, body: '' };
      }

      try {
        const route = compiled
          .map((candidate) => ({ candidate, params: match(candidate, method, segments) }))
          .find((entry) => entry.params !== undefined);

        if (!route || !route.params) {
          // Distinguish "wrong method" from "no such path" for better DX,
          // without revealing anything about private resources.
          const pathExists = compiled.some((candidate) => matchPath(candidate, segments) !== undefined);
          throw pathExists
            ? AppError.badRequest('That method is not supported for this endpoint.')
            : AppError.notFound('That endpoint does not exist.');
        }

        const { candidate, params } = route;

        // Size limit before parsing: never allocate a large object graph for a
        // request we are going to reject anyway.
        if (request.body !== undefined && Buffer.byteLength(request.body, 'utf8') > MAX_REQUEST_BYTES) {
          throw AppError.tooLarge('That request is too large.');
        }

        let body: unknown;
        if (request.body !== undefined && request.body.length > 0) {
          const contentType = request.headers['content-type'] ?? '';
          if (!contentType.includes('application/json')) {
            throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send this request as JSON.');
          }
          try {
            body = JSON.parse(request.body);
          } catch {
            throw AppError.badRequest('That request body is not valid JSON.');
          }
        }

        let auth = await options.auth.resolve(request, requestId);
        if (!auth) {
          if (!candidate.public) throw AppError.unauthenticated();
          auth = { userId: 'anonymous', role: 'CITIZEN', requestId };
        }

        const context: RouteContext = {
          auth,
          params,
          query: request.query,
          body,
          request,
        };

        const result = await candidate.handler(context);

        logger.info('request handled', {
          method,
          route: candidate.pattern,
          userRole: auth.role,
          status: result === undefined ? 204 : (candidate.successStatus ?? 200),
        });

        if (result === undefined) return { status: 204, headers: { ...cors }, body: '' };
        return jsonResponse(candidate.successStatus ?? 200, result, cors);
      } catch (error) {
        return errorResponse(error, requestId, logger, cors);
      }
    },
  };
}
