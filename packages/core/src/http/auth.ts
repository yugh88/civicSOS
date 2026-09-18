import type { AuthContext, Role } from '../domain/types.js';
import type { AuthResolver, HttpRequest } from './types.js';
import { AppError } from '../domain/errors.js';
import { ROLES } from '../domain/types.js';
import type { Logger } from '../util/logger.js';

/**
 * Authentication resolvers.
 *
 * Two identity sources, both producing the same `AuthContext`:
 *
 *  - Cognito ID tokens for real accounts (verified in `@civicsos/aws`).
 *  - Short-lived guest tokens, HMAC-signed by this server, for the demo. A
 *    guest gets a unique id and their own copy of the demo data, so demo
 *    traffic can never read or write a real citizen's case.
 *
 * Both paths go through `resolve`, and every route except `/health` and the
 * public knowledge endpoint requires one of them to succeed.
 */

export interface TokenClaims {
  sub: string;
  email?: string;
  /** Cognito group memberships, mapped to a role. */
  groups?: string[];
}

export type TokenVerifier = (token: string) => Promise<TokenClaims | undefined>;

/** Cognito groups are the source of truth for roles; a token can't self-assign. */
export function roleFromGroups(groups: string[] | undefined): Role {
  if (!groups || groups.length === 0) return 'CITIZEN';
  const normalized = groups.map((group) => group.toUpperCase());
  if (normalized.includes('ADMIN')) return 'ADMIN';
  if (normalized.includes('AUTHORITY')) return 'AUTHORITY';
  return 'CITIZEN';
}

function bearerToken(request: HttpRequest): string | undefined {
  const header = request.headers.authorization ?? request.headers.Authorization;
  if (typeof header !== 'string') return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

/* ------------------------------------------------------------------ */
/* Guest (demo) sessions                                              */
/* ------------------------------------------------------------------ */

export const GUEST_PREFIX = 'guest_';
/** Guest sessions are deliberately short: long enough to demo, not to squat. */
export const GUEST_TTL_SECONDS = 60 * 60 * 6;

export interface GuestTokenPayload {
  userId: string;
  /** Unix seconds. */
  exp: number;
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return bytes.toString('base64url');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(signature));
}

/** Constant-time comparison, so a signature check cannot be timed. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function issueGuestToken(secret: string, now: Date = new Date()): Promise<{ token: string; userId: string; expiresAt: string }> {
  assertGuestSecret(secret);
  const random = base64url(globalThis.crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g, '');
  const userId = `${GUEST_PREFIX}${random}`;
  const payload: GuestTokenPayload = { userId, exp: Math.floor(now.getTime() / 1000) + GUEST_TTL_SECONDS };
  const encoded = base64url(JSON.stringify(payload));
  const signature = await hmac(secret, encoded);
  return {
    token: `${encoded}.${signature}`,
    userId,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export async function verifyGuestToken(secret: string, token: string, now: Date = new Date()): Promise<GuestTokenPayload | undefined> {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return undefined;

  const expected = await hmac(secret, encoded);
  if (!safeEqual(signature, expected)) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as GuestTokenPayload;
    if (typeof payload.userId !== 'string' || !payload.userId.startsWith(GUEST_PREFIX)) return undefined;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

/** A weak guest secret would let anyone mint guest sessions, so we refuse one. */
export function assertGuestSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) {
    throw AppError.internal({ reason: 'GUEST_SESSION_SECRET missing or shorter than 32 characters' });
  }
}

/* ------------------------------------------------------------------ */
/* Composite resolver                                                 */
/* ------------------------------------------------------------------ */

export interface AuthResolverOptions {
  /** Verifies a Cognito ID token. Omit to run guest-only (local dev). */
  verifyIdToken?: TokenVerifier;
  /** Secret for guest tokens. Omit to disable the demo path entirely. */
  guestSecret?: string;
  logger: Logger;
  /** Clock, so token expiry is testable and consistent with the services. */
  now?: () => Date;
  /**
   * Local development only. When set, a `x-dev-user`/`x-dev-role` header pair
   * is accepted as an identity. Guarded by an explicit flag and refused
   * outright unless the stage is `local`, because an accidentally-enabled
   * trusted header would be a complete authentication bypass.
   */
  devHeaders?: { enabled: boolean; stage: string };
}

export function createAuthResolver(options: AuthResolverOptions): AuthResolver {
  const devEnabled = Boolean(options.devHeaders?.enabled) && options.devHeaders?.stage === 'local';
  if (options.devHeaders?.enabled && !devEnabled) {
    options.logger.error('dev auth headers requested outside the local stage and were refused', {
      stage: options.devHeaders.stage,
    });
  }

  return {
    async resolve(request: HttpRequest, requestId: string): Promise<AuthContext | undefined> {
      const token = bearerToken(request);

      if (token) {
        // Guest tokens carry a `.` separated payload and signature; Cognito
        // tokens are three-part JWTs. Try guest first only when it is enabled.
        if (options.guestSecret) {
          const guest = await verifyGuestToken(options.guestSecret, token, (options.now ?? (() => new Date()))());
          if (guest) {
            return { userId: guest.userId, role: 'CITIZEN', requestId };
          }
        }

        if (options.verifyIdToken) {
          try {
            const claims = await options.verifyIdToken(token);
            if (claims?.sub) {
              return {
                userId: claims.sub,
                role: roleFromGroups(claims.groups),
                email: claims.email,
                requestId,
              };
            }
          } catch (error) {
            options.logger.warn('token verification failed', { requestId, error: String(error).slice(0, 120) });
          }
        }

        return undefined;
      }

      if (devEnabled) {
        const devUser = request.headers['x-dev-user'];
        if (typeof devUser === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(devUser)) {
          const requested = (request.headers['x-dev-role'] ?? 'CITIZEN').toUpperCase();
          const role = (ROLES as readonly string[]).includes(requested) ? (requested as Role) : 'CITIZEN';
          return { userId: devUser, role, requestId };
        }
      }

      return undefined;
    },
  };
}

export function isGuest(auth: AuthContext): boolean {
  return auth.userId.startsWith(GUEST_PREFIX);
}
