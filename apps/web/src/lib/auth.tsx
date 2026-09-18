'use client';

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch } from './api';
import { COGNITO, COGNITO_ENABLED } from './config';
import type { GuestSessionResponse } from './types';

/**
 * Session management.
 *
 * Two kinds of session, one interface:
 *
 *  - A Cognito account (email + password, SRP so the password is never sent).
 *  - A guest demo session: one click, its own private copy of the demo cases,
 *    expires on its own.
 *
 * Roles are read from the ID token's `cognito:groups` claim for display only.
 * Every authorization decision is made again on the server; nothing here is
 * load-bearing for security.
 */

export type SessionKind = 'cognito' | 'guest';

export interface Session {
  kind: SessionKind;
  userId: string;
  email?: string;
  displayName?: string;
  role: 'CITIZEN' | 'AUTHORITY' | 'ADMIN';
  /** Unix milliseconds. */
  expiresAt: number;
}

interface AuthState {
  session?: Session;
  /** True until the stored session has been checked on first load. */
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  /** Returns a valid bearer token, refreshing a Cognito session if needed. */
  getToken(): Promise<string | undefined>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  startDemo(): Promise<void>;
  signOut(): void;
  /** True when a real user pool is configured for this deployment. */
  accountsEnabled: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const GUEST_STORAGE_KEY = 'civicsos.guest';

/**
 * Where tokens live.
 *
 * The guest token is kept in `sessionStorage` so a demo session dies with the
 * tab. Cognito's own library keeps its refresh token in `localStorage`; the ID
 * token is held in memory here and re-derived from the refresh token on reload.
 * That is the standard browser tradeoff for a SPA without a server session
 * layer, and SECURITY.md says so explicitly rather than pretending otherwise.
 */
function readStoredGuest(): { token: string; userId: string; expiresAt: number } | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { token?: string; userId?: string; expiresAt?: number };
    if (!parsed.token || !parsed.userId || !parsed.expiresAt) return undefined;
    if (parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
      return undefined;
    }
    return { token: parsed.token, userId: parsed.userId, expiresAt: parsed.expiresAt };
  } catch {
    return undefined;
  }
}

function userPool(): CognitoUserPool | undefined {
  if (!COGNITO_ENABLED) return undefined;
  return new CognitoUserPool({ UserPoolId: COGNITO.userPoolId, ClientId: COGNITO.clientId });
}

function roleFromSession(session: CognitoUserSession): Session['role'] {
  const payload = session.getIdToken().decodePayload() as Record<string, unknown>;
  const groups = Array.isArray(payload['cognito:groups']) ? (payload['cognito:groups'] as string[]) : [];
  const normalized = groups.map((group) => String(group).toUpperCase());
  if (normalized.includes('ADMIN')) return 'ADMIN';
  if (normalized.includes('AUTHORITY')) return 'AUTHORITY';
  return 'CITIZEN';
}

function sessionFromCognito(session: CognitoUserSession): Session {
  const payload = session.getIdToken().decodePayload() as Record<string, unknown>;
  return {
    kind: 'cognito',
    userId: String(payload.sub ?? ''),
    email: typeof payload.email === 'string' ? payload.email : undefined,
    role: roleFromSession(session),
    expiresAt: session.getIdToken().getExpiration() * 1000,
  };
}

/** Cognito's errors are technical; these are the ones a person can act on. */
function friendlyCognitoError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    NotAuthorizedException: 'That email and password combination did not work.',
    UserNotFoundException: 'That email and password combination did not work.',
    UserNotConfirmedException: 'Please confirm your email first — check your inbox for the code.',
    UsernameExistsException: 'There is already an account with that email. Try signing in instead.',
    CodeMismatchException: 'That confirmation code is not right. Please check it and try again.',
    ExpiredCodeException: 'That code has expired. Request a new one.',
    InvalidPasswordException:
      'Please use at least 12 characters with upper case, lower case and a number.',
    InvalidParameterException: 'Please check the email address and password and try again.',
    LimitExceededException: 'Too many attempts. Please wait a few minutes and try again.',
    TooManyRequestsException: 'Too many attempts. Please wait a few minutes and try again.',
  };
  return new Error(messages[code] ?? 'We could not complete that. Please try again in a moment.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true });
  /** Held in memory, never rendered, never persisted for a Cognito session. */
  const tokenRef = useRef<string | undefined>(undefined);
  const guestRef = useRef<{ token: string; expiresAt: number } | undefined>(undefined);

  // Restore whichever session is available on first load.
  useEffect(() => {
    const guest = readStoredGuest();
    if (guest) {
      guestRef.current = { token: guest.token, expiresAt: guest.expiresAt };
      setState({
        loading: false,
        session: {
          kind: 'guest',
          userId: guest.userId,
          displayName: 'Demo visitor',
          role: 'CITIZEN',
          expiresAt: guest.expiresAt,
        },
      });
      return;
    }

    const pool = userPool();
    const current = pool?.getCurrentUser();
    if (!current) {
      setState({ loading: false });
      return;
    }

    current.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session?.isValid()) {
        setState({ loading: false });
        return;
      }
      tokenRef.current = session.getIdToken().getJwtToken();
      setState({ loading: false, session: sessionFromCognito(session) });
    });
  }, []);

  /**
   * Returns a usable bearer token.
   *
   * For Cognito, `getSession` refreshes with the refresh token when the ID token
   * has expired, so a long-lived tab keeps working without the user noticing.
   */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    const guest = guestRef.current;
    if (guest) {
      if (guest.expiresAt > Date.now()) return guest.token;
      guestRef.current = undefined;
      window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
      setState({ loading: false });
      return undefined;
    }

    const pool = userPool();
    const current = pool?.getCurrentUser();
    if (!current) return undefined;

    return new Promise((resolve) => {
      current.getSession((error: Error | null, session: CognitoUserSession | null) => {
        if (error || !session?.isValid()) {
          tokenRef.current = undefined;
          setState({ loading: false });
          resolve(undefined);
          return;
        }
        const token = session.getIdToken().getJwtToken();
        tokenRef.current = token;
        resolve(token);
      });
    });
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const pool = userPool();
    if (!pool) throw new Error('Accounts are not available on this deployment. Try the demo instead.');
    return new Promise<{ needsConfirmation: boolean }>((resolve, reject) => {
      pool.signUp(email, password, [new CognitoUserAttribute({ Name: 'email', Value: email })], [], (error, result) => {
        if (error) {
          reject(friendlyCognitoError(error));
          return;
        }
        resolve({ needsConfirmation: result?.userConfirmed !== true });
      });
    });
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    const pool = userPool();
    if (!pool) throw new Error('Accounts are not available on this deployment.');
    const user = new CognitoUser({ Username: email, Pool: pool });
    return new Promise<void>((resolve, reject) => {
      user.confirmRegistration(code, true, (error) => {
        if (error) reject(friendlyCognitoError(error));
        else resolve();
      });
    });
  }, []);

  const resendCode = useCallback(async (email: string) => {
    const pool = userPool();
    if (!pool) throw new Error('Accounts are not available on this deployment.');
    const user = new CognitoUser({ Username: email, Pool: pool });
    return new Promise<void>((resolve, reject) => {
      user.resendConfirmationCode((error) => {
        if (error) reject(friendlyCognitoError(error));
        else resolve();
      });
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const pool = userPool();
    if (!pool) throw new Error('Accounts are not available on this deployment. Try the demo instead.');
    const user = new CognitoUser({ Username: email, Pool: pool });

    return new Promise<void>((resolve, reject) => {
      user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
        onSuccess(session) {
          // A guest session and an account session must never coexist.
          window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
          guestRef.current = undefined;
          tokenRef.current = session.getIdToken().getJwtToken();
          setState({ loading: false, session: sessionFromCognito(session) });
          resolve();
        },
        onFailure(error) {
          reject(friendlyCognitoError(error));
        },
        newPasswordRequired() {
          reject(new Error('This account needs a new password. Please contact support.'));
        },
      });
    });
  }, []);

  const startDemo = useCallback(async () => {
    try {
      const result = await apiFetch<GuestSessionResponse>('/auth/guest', { method: 'POST', body: {} });
      const expiresAt = new Date(result.expiresAt).getTime();
      window.sessionStorage.setItem(
        GUEST_STORAGE_KEY,
        JSON.stringify({ token: result.token, userId: result.userId, expiresAt }),
      );
      guestRef.current = { token: result.token, expiresAt };
      tokenRef.current = undefined;
      setState({
        loading: false,
        session: { kind: 'guest', userId: result.userId, displayName: 'Demo visitor', role: 'CITIZEN', expiresAt },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new Error('The demo is turned off on this deployment.');
      }
      throw error;
    }
  }, []);

  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
    guestRef.current = undefined;
    tokenRef.current = undefined;
    userPool()?.getCurrentUser()?.signOut();
    setState({ loading: false });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      getToken,
      signUp,
      confirmSignUp,
      resendCode,
      signIn,
      startDemo,
      signOut,
      accountsEnabled: COGNITO_ENABLED,
    }),
    [state, getToken, signUp, confirmSignUp, resendCode, signIn, startDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/**
 * Authenticated fetch helper.
 *
 * Resolves the token first so callers never juggle it, and turns an expired
 * session into a clear, actionable message instead of a bare 401.
 */
export function useApi() {
  const { getToken } = useAuth();

  return useCallback(
    async <T,>(path: string, options: Omit<Parameters<typeof apiFetch>[1], 'token'> = {}): Promise<T> => {
      const token = await getToken();
      if (!token) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
      }
      return apiFetch<T>(path, { ...options, token });
    },
    [getToken],
  );
}
