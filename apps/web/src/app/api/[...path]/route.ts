import { NextResponse, type NextRequest } from 'next/server';
import type { HttpRequest } from '@civicsos/core';
import { LOCAL_API_ENABLED, getLocalRuntime } from '@/server/local-runtime';

/**
 * Local API route handler.
 *
 * Adapts a Next.js request into the transport-agnostic `HttpRequest` the shared
 * router understands — the same adaptation the Lambda does for API Gateway
 * events. Routing, validation, authorization and business logic all live in
 * `@civicsos/core` and are shared verbatim.
 *
 * Disabled whenever a deployed API is configured, so there is exactly one active
 * API per environment and no chance of the two diverging in production.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Guard against this becoming a shadow API in a deployed environment. */
function disabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'That endpoint does not exist.',
        requestId: 'local-api-disabled',
      },
    },
    { status: 404 },
  );
}

async function handle(request: NextRequest, params: Promise<{ path?: string[] }>): Promise<NextResponse> {
  if (!LOCAL_API_ENABLED) return disabledResponse();

  const { path } = await params;
  const { router } = await getLocalRuntime();

  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const query: Record<string, string | undefined> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  // Reading the body as text keeps the router responsible for the size limit
  // and for JSON parsing, exactly as in Lambda.
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  const httpRequest: HttpRequest = {
    method: request.method,
    path: `/${(path ?? []).join('/')}`,
    query,
    headers,
    body: body && body.length > 0 ? body : undefined,
  };

  const response = await router.handle(httpRequest);

  return new NextResponse(response.body || null, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context.params);
}
export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context.params);
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context.params);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context.params);
}
export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context.params);
}
