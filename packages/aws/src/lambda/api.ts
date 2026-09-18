import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import type { HttpRequest } from '@civicsos/core';
import { getAwsRuntime } from '../runtime.js';

/**
 * API Lambda — the single entry point behind API Gateway's HTTP API.
 *
 * One function rather than one per route: on the free tier a single warm
 * container serving every route has far better cold-start behaviour and far
 * lower operational surface than a dozen functions, while the code inside is
 * still cleanly modular (router -> service -> rules). The modular boundary that
 * matters is in the code, not in the deployment topology.
 */

function toHttpRequest(event: APIGatewayProxyEventV2): HttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    headers[key.toLowerCase()] = value;
  }

  // `rawPath` includes the stage prefix when the API is not using $default,
  // so the configured stage segment is stripped to keep route patterns clean.
  const stage = event.requestContext?.stage;
  let path = event.rawPath || '/';
  if (stage && stage !== '$default' && path.startsWith(`/${stage}/`)) {
    path = path.slice(stage.length + 1);
  }

  const body =
    event.body === undefined || event.body === null
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

  return {
    method: event.requestContext?.http?.method ?? 'GET',
    path,
    query: (event.queryStringParameters ?? {}) as Record<string, string | undefined>,
    headers,
    body,
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> => {
  const runtime = await getAwsRuntime();
  const request = toHttpRequest(event);

  // API Gateway's request id ties the access log, this Lambda's logs and the
  // client's error message together.
  if (!request.headers['x-request-id']) {
    const requestId = event.requestContext?.requestId ?? context.awsRequestId;
    if (requestId) request.headers['x-request-id'] = requestId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  }

  const response = await runtime.router.handle(request);

  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  };
};
