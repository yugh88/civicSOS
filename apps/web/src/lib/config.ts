/**
 * Client configuration.
 *
 * Read from `NEXT_PUBLIC_*` variables at build time. Nothing secret lives here —
 * a Cognito user pool id and client id are public identifiers by design, and the
 * Gemini key never leaves the server.
 */

/**
 * Base URL of the deployed API.
 *
 * When unset (local development with no AWS resources) the app talks to its own
 * Next.js route handlers, which run the identical router from `@civicsos/core`
 * against in-memory adapters. One code path for business logic, two places it
 * can be hosted.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') || '/api';

export const COGNITO = {
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
};

/** True when a real user pool is configured; otherwise only the demo works. */
export const COGNITO_ENABLED = COGNITO.userPoolId.length > 0 && COGNITO.clientId.length > 0;

export const APP_NAME = 'CivicSOS';
export const APP_TAGLINE = 'Tell us what happened. We work out what you should do next.';
