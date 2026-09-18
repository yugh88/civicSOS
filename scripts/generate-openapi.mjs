#!/usr/bin/env node
/**
 * Generates `docs/openapi.json` from the live route table.
 *
 * The spec is derived from the same `buildRoutes` definition the server uses,
 * so the documentation cannot drift from the implementation: add a route and it
 * appears here, change a method and the spec changes with it.
 *
 * Run with: npm run openapi
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The core package is TypeScript source; use its compiled output.
const core = await import(resolve(root, 'packages/core/dist/index.js'));

const {
  buildRoutes,
  InMemoryCaseRepository,
  InMemoryObjectStorage,
  InMemoryEventPublisher,
  InMemoryRateLimiter,
  createAuditWriter,
  createLogger,
  disabledGeminiClient,
  defaultRuntimeConfig,
  systemClock,
} = core;

const logger = createLogger({}, 'error');
const repository = new InMemoryCaseRepository();

const routes = buildRoutes({
  repository,
  storage: new InMemoryObjectStorage(),
  events: new InMemoryEventPublisher(),
  gemini: disabledGeminiClient,
  audit: createAuditWriter(repository, logger),
  logger,
  clock: systemClock,
  rateLimiter: new InMemoryRateLimiter(),
  config: { ...defaultRuntimeConfig, guestSecret: 'x'.repeat(32) },
});

/** `/cases/:caseId` -> `/cases/{caseId}` plus its parameter list. */
function toOpenApiPath(pattern) {
  const parameters = [];
  const path = pattern.replace(/:([A-Za-z0-9_]+)/g, (_match, name) => {
    parameters.push({
      name,
      in: 'path',
      required: true,
      description: `Identifier of the ${name.replace(/Id$/, '')}.`,
      schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{3,80}$' },
    });
    return `{${name}}`;
  });
  return { path, parameters };
}

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const paths = {};

for (const route of routes) {
  const { path, parameters } = toOpenApiPath(route.pattern);
  paths[path] ??= {};

  const successStatus = String(route.successStatus ?? 200);
  const operation = {
    summary: route.summary,
    operationId: `${route.method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}`,
    tags: [path.split('/')[1] || 'root'],
    security: route.public ? [] : [{ bearerAuth: [] }],
    ...(parameters.length > 0 ? { parameters } : {}),
    responses: {
      [successStatus]: {
        description: 'Success.',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      ...(route.public
        ? {}
        : {
            401: errorResponse('No credentials, or the token is invalid or expired.'),
            403: errorResponse('Authenticated but not permitted.'),
            404: errorResponse('Not found — also returned for a resource owned by another user.'),
          }),
      422: errorResponse('Validation failed; `issues` names the offending fields.'),
      429: errorResponse('Rate limited.'),
      500: errorResponse('Unexpected server error. The body carries a request id, never internal detail.'),
    },
  };

  if (route.method === 'POST' || route.method === 'PATCH') {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    };
  }

  paths[path][route.method.toLowerCase()] = operation;
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'CivicSOS API',
    version: '1.0.0',
    description: [
      'CivicSOS turns a described civic problem into a resolution plan, a submission-ready',
      'complaint and a tracked case.',
      '',
      'Authentication: a bearer token, either a Cognito ID token or a short-lived guest',
      'demo token from `POST /auth/guest`.',
      '',
      'Errors: every non-2xx response is `{ "error": { code, message, issues?, requestId } }`.',
      'The `message` is always safe to show an end user; internal detail never crosses the',
      'boundary. Requesting a resource owned by another user returns 404 rather than 403, so',
      'the existence of other users’ cases is not disclosed.',
      '',
      'This document is generated from the server’s own route table — see',
      'scripts/generate-openapi.mjs.',
    ].join('\n'),
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://{apiId}.execute-api.{region}.amazonaws.com', description: 'Deployed HTTP API', variables: { apiId: { default: 'xxxxxxxxxx' }, region: { default: 'ap-south-1' } } },
    { url: 'http://localhost:3000/api', description: 'Local development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_FAILED' },
              message: { type: 'string', description: 'Safe to display to an end user.' },
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { field: { type: 'string' }, message: { type: 'string' } },
                },
              },
              requestId: { type: 'string', description: 'Quote this when reporting a problem.' },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths,
};

const outputPath = resolve(root, 'docs/openapi.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

const operationCount = Object.values(paths).reduce((sum, item) => sum + Object.keys(item).length, 0);
console.log(`Wrote ${outputPath} (${Object.keys(paths).length} paths, ${operationCount} operations)`);
