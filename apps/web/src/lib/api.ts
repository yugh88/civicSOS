import { API_BASE_URL } from './config';

/**
 * API client.
 *
 * Thin on purpose. Its one real job is turning the API's error envelope into an
 * `ApiError` carrying a message that is already safe and sensible to show a
 * person — the backend never sends internal detail, so the UI never has to
 * decide whether an error is presentable.
 */

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Safe to render directly. */
    message: string,
    readonly issues: FieldIssue[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying the same request might work. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }

  issueFor(field: string): string | undefined {
    return this.issues.find((issue) => issue.field === field || issue.field.endsWith(`.${field}`))?.message;
  }
}

/** A network failure is not an API error, but the UI treats both the same way. */
const NETWORK_MESSAGE = "We couldn't reach CivicSOS. Check your connection and try again.";

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Bearer token: a Cognito ID token or a guest demo token. */
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      // The API is credentialed by bearer token, not by cookie.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; message?: string; issues?: FieldIssue[]; requestId?: string } })
      ?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'UNKNOWN',
      envelope?.message ?? 'Something went wrong. Please try again.',
      envelope?.issues ?? [],
      envelope?.requestId,
    );
  }

  return payload as T;
}

/**
 * Uploads a file straight to S3 with the pre-signed URL and headers the API
 * returned. The headers must be sent exactly as given or the signature fails,
 * which is precisely the guarantee we want.
 */
export async function uploadToSignedUrl(
  url: string,
  headers: Record<string, string>,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers, body: file, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', "We couldn't upload that file. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'UPLOAD_FAILED', "That upload didn't go through. Please try again.");
  }
}
