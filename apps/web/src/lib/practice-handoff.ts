import type { SubmissionPayload } from './types';

/**
 * Handing a prepared complaint to the practice portal.
 *
 * The browser assistant exists because a web page cannot touch another origin's
 * DOM — that restriction is the whole reason official-portal autofill needs an
 * extension. The practice portal is the one exception: CivicSOS serves it
 * itself, so it is **same-origin**, and the app can hand it the payload
 * directly.
 *
 * That matters for more than convenience. It means the autofill flow can be
 * demonstrated and tested end to end by anyone who opens the app, with no
 * extension installed and no configuration — which is what makes it a usable
 * rehearsal for the real thing rather than a screenshot in a README.
 *
 * What it is NOT: this is not the extension, and it is not evidence that the
 * extension works. It exercises the same *shape* — prepare, hand off, wait at a
 * gate, resume, fill, stop before Submit — against a page whose selectors are
 * verified by construction. The extension path still runs when one is
 * installed, and on a real portal it is the only path there is.
 */

/** Long enough to sign in at the practice portal, short enough not to linger. */
const TTL_MS = 10 * 60 * 1000;

const KEY_PREFIX = 'civicsos:practice-handoff:';

export interface PracticeHandoff {
  payload: SubmissionPayload;
  expiresAt: number;
}

/**
 * localStorage rather than sessionStorage.
 *
 * `window.open` does not reliably copy sessionStorage into the new tab across
 * browsers, and the portal opens in a new tab by design — the citizen keeps
 * their case open behind it.
 */
function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function newId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sweeps expired hand-offs so an abandoned one cannot sit in storage. */
function sweep(): void {
  try {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PracticeHandoff>;
        if (!entry.expiresAt || entry.expiresAt < now) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Private windows and blocked site data both throw. Nothing here is
    // important enough to fail the citizen's click over.
  }
}

/** Stores a payload for the practice portal and returns its one-time id. */
export function storeHandoff(payload: SubmissionPayload): string | undefined {
  try {
    sweep();
    const id = newId();
    const entry: PracticeHandoff = { payload, expiresAt: Date.now() + TTL_MS };
    localStorage.setItem(storageKey(id), JSON.stringify(entry));
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Reads a hand-off without consuming it.
 *
 * Deliberately not read-once: the portal may sit at its sign-in gate for a
 * while, and a citizen who reloads the page mid-flow should not silently lose
 * the complaint they are trying to file. `clearHandoff` runs once the fields
 * are actually populated.
 */
export function readHandoff(id: string): SubmissionPayload | undefined {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Partial<PracticeHandoff>;
    if (!entry.expiresAt || entry.expiresAt < Date.now() || !entry.payload) {
      localStorage.removeItem(storageKey(id));
      return undefined;
    }
    return entry.payload;
  } catch {
    return undefined;
  }
}

export function clearHandoff(id: string): void {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    // Nothing to do; the TTL sweep will catch it.
  }
}

/** The query parameter the portal reads its hand-off id from. */
export const HANDOFF_PARAM = 'assist';
