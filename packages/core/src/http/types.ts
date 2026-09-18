import type { AuthContext } from '../domain/types.js';

/**
 * Transport-agnostic HTTP types.
 *
 * The router below is driven by these, so the exact same handler code serves
 * API Gateway (in Lambda) and Next.js route handlers (in local dev and on
 * Amplify). One implementation, one set of tests, no duplicated business logic.
 */

export interface HttpRequest {
  method: string;
  /** Path without the stage prefix, e.g. `/cases/case_abc/timeline`. */
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  /** Raw body text. Parsed and size-checked by the router. */
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Standard error envelope. Every non-2xx response has exactly this shape. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    issues?: Array<{ field: string; message: string }>;
    requestId: string;
  };
}

export interface RouteContext {
  auth: AuthContext;
  /** Path parameters captured from the route pattern. */
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  /** Parsed JSON body, or undefined when the request had none. */
  body: unknown;
  request: HttpRequest;
}

export type RouteHandler = (context: RouteContext) => Promise<unknown>;

export interface RouteDefinition {
  method: string;
  /** Pattern with `:param` segments, e.g. `/cases/:caseId/evidence`. */
  pattern: string;
  handler: RouteHandler;
  /** Anonymous access. Only used for the health check and public knowledge. */
  public?: boolean;
  /** Status for a successful response. Defaults to 200 (204 when no body). */
  successStatus?: number;
  /** Human-readable summary, used to generate the OpenAPI document. */
  summary: string;
}

/** Resolves the caller's identity from request headers. */
export interface AuthResolver {
  resolve(request: HttpRequest, requestId: string): Promise<AuthContext | undefined>;
}
