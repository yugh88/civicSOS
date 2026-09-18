/**
 * Profile-change signal.
 *
 * The header shows a points balance and an unread count that the shell loads
 * once per navigation. Actions that change either of those — redeeming a
 * reward, creating or resolving a case, marking a notification read — can
 * happen without navigating, which would leave the header stale.
 *
 * A browser `CustomEvent` rather than a context or a store: it is one number in
 * one component, the emitters and the listener never need to know about each
 * other, and it costs nothing when nobody is listening.
 */

const PROFILE_CHANGED = 'civicsos:profile-changed';

/** Call after any action that changes points, counters or unread state. */
export function notifyProfileChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED));
}

/** Subscribes to profile changes. Returns an unsubscribe function. */
export function onProfileChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PROFILE_CHANGED, handler);
  return () => window.removeEventListener(PROFILE_CHANGED, handler);
}
