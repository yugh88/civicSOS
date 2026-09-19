import type { HandoffMessage } from './types.js';

/**
 * Service worker.
 *
 * The only bridge between the CivicSOS web app and a portal tab. It holds a
 * hand-off in memory just long enough to pass it to the tab the citizen opens,
 * and drops it afterwards — nothing is persisted, because a complaint sitting in
 * extension storage is a liability with no upside.
 */

interface PendingHandoff {
  payload: HandoffMessage['payload'];
  targetOrigin: string;
  expiresAt: number;
}

/** A hand-off the citizen never used should not sit around. */
const HANDOFF_TTL_MS = 5 * 60 * 1000;

let pending: PendingHandoff | undefined;

/**
 * Accepts a hand-off from the CivicSOS web app only.
 *
 * `externally_connectable` in the manifest restricts which origins may even
 * reach this listener; this is the second check, not the first.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (message?.type !== 'CIVICSOS_HANDOFF') {
    respond({ ok: false, reason: 'unknown-message' });
    return;
  }
  if (!sender.origin) {
    respond({ ok: false, reason: 'no-origin' });
    return;
  }

  pending = {
    payload: message.payload,
    targetOrigin: message.targetOrigin,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  };
  respond({ ok: true });
});

/** Delivers the pending hand-off once the portal tab has finished loading. */
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !pending) return;
  if (Date.now() > pending.expiresAt) {
    pending = undefined;
    return;
  }

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return;
  }
  if (origin !== pending.targetOrigin) return;

  const handoff: HandoffMessage = {
    type: 'CIVICSOS_HANDOFF',
    targetOrigin: pending.targetOrigin,
    payload: pending.payload,
  };

  try {
    await chrome.tabs.sendMessage(tabId, handoff);
  } catch {
    // The content script may not be injected on this page; the web app's own
    // copy-ready view is the fallback, so this is not worth surfacing.
  } finally {
    // Single use.
    pending = undefined;
  }
});
