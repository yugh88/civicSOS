import { mappingFor, unsupportedFields, type PortalMapping } from './mappings.js';
import type { AssistantState, HandoffMessage, PayloadField, SubmissionPayload } from './types.js';

/**
 * The content script.
 *
 * Runs on a verified official portal after the citizen chose to continue there.
 * Its whole job is to save typing — and to be extremely clear about the things
 * it will not do.
 *
 * Four rules, enforced here rather than promised:
 *
 *  1. It fills only fields present in a verified mapping for this exact origin.
 *     No mapping, no filling — it shows a review panel instead.
 *  2. It never touches a password field, and never reads one.
 *  3. When a login, OTP or CAPTCHA is on screen it stops and waits. It does not
 *     attempt them, and it has no code that could.
 *  4. It never clicks the submit control. The selector is recorded precisely so
 *     it can be excluded.
 *
 * The payload lives in this script's memory for the tab's lifetime. Nothing is
 * written to storage.
 */

let payload: SubmissionPayload | undefined;
let state: AssistantState = { phase: 'IDLE' };
let panel: HTMLElement | undefined;

/* ------------------------------------------------------------------ */
/* Receiving the hand-off                                             */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message: HandoffMessage, _sender, respond) => {
  if (message?.type !== 'CIVICSOS_HANDOFF') return;

  // The payload is addressed to one origin. Refuse it anywhere else, so a
  // mis-targeted hand-off cannot spray a complaint across tabs.
  if (message.targetOrigin !== window.location.origin) {
    respond({ ok: false, reason: 'origin-mismatch' });
    return;
  }

  payload = message.payload;
  render();
  attempt();
  respond({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Filling                                                            */
/* ------------------------------------------------------------------ */

/** Password inputs are untouchable, full stop. */
function isCredentialField(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  const type = element.type.toLowerCase();
  const name = `${element.name} ${element.id} ${element.autocomplete}`.toLowerCase();
  return (
    type === 'password' ||
    /pass(word|wd)|otp|captcha|cvv|pin\b/.test(name) ||
    element.autocomplete === 'one-time-code'
  );
}

/**
 * Sets a value the way React and Angular both notice.
 *
 * Assigning `.value` directly does not fire the framework's own setter, so the
 * portal's state would not update and the field would silently revert.
 */
function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** True while the citizen still has something of their own to do. */
function blockedBy(mapping: PortalMapping): string | undefined {
  if (mapping.loggedOutSelector && document.querySelector(mapping.loggedOutSelector)) {
    return 'Sign in on this site and CivicSOS will carry on.';
  }
  if (mapping.challengeSelector && document.querySelector(mapping.challengeSelector)) {
    return 'Complete the CAPTCHA or OTP and CivicSOS will carry on.';
  }
  return undefined;
}

function fill(mapping: PortalMapping, fields: PayloadField[]): { filled: number; skipped: string[] } {
  let filled = 0;
  const skipped = unsupportedFields(mapping, fields);

  for (const field of fields) {
    const selector = mapping.fields[field.key];
    if (!selector) continue;

    const element = document.querySelector(selector);
    if (!element) {
      skipped.push(field.label);
      continue;
    }
    // Belt and braces: a mapping should never point at a credential field, but
    // if one ever did, this refuses rather than trusting the config.
    if (isCredentialField(element)) {
      skipped.push(`${field.label} (refused: credential field)`);
      continue;
    }
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      skipped.push(field.label);
      continue;
    }

    setFieldValue(element, field.value);
    element.dataset.civicsosFilled = 'true';
    filled += 1;
  }

  return { filled, skipped };
}

/**
 * Tries to fill, or explains why it is waiting.
 *
 * Re-runs when the page changes, so a single-page portal that reveals the form
 * after login is picked up without the citizen doing anything.
 */
function attempt(): void {
  if (!payload) return;

  const mapping = mappingFor(window.location.origin);
  if (!mapping) {
    state = {
      phase: 'REVIEW_ONLY',
      reason: 'CivicSOS has no verified field map for this site yet, so it will not type into it. Copy each field below instead.',
    };
    render();
    return;
  }

  const blocked = blockedBy(mapping);
  if (blocked) {
    state = { phase: 'WAITING_FOR_YOU', reason: blocked };
    render();
    return;
  }

  const result = fill(mapping, payload.fields);
  state = { phase: 'READY', ...result };
  render();
}

// Portals reveal their form after login or a route change; watch for it.
const observer = new MutationObserver(() => {
  if (payload && (state.phase === 'WAITING_FOR_YOU' || state.phase === 'IDLE')) attempt();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

/* ------------------------------------------------------------------ */
/* The panel                                                          */
/* ------------------------------------------------------------------ */

function render(): void {
  if (!payload) return;
  panel ??= createPanel();

  const body = panel.querySelector('[data-civicsos="body"]');
  const status = panel.querySelector('[data-civicsos="status"]');
  if (!body || !status) return;

  status.textContent =
    state.phase === 'WAITING_FOR_YOU'
      ? state.reason
      : state.phase === 'READY'
        ? `Filled ${state.filled} field${state.filled === 1 ? '' : 's'}. Check everything, then submit it yourself.`
        : state.phase === 'REVIEW_ONLY'
          ? state.reason
          : 'Preparing…';

  body.replaceChildren();

  for (const field of payload.fields) {
    const row = document.createElement('div');
    row.style.cssText = 'border-top:1px solid #e2e6eb;padding:10px 0;';

    const label = document.createElement('div');
    label.textContent = field.label;
    label.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;';

    const value = document.createElement('div');
    value.textContent = field.value.length > 160 ? `${field.value.slice(0, 160)}…` : field.value;
    value.style.cssText = 'font-size:13px;color:#172033;margin-top:3px;white-space:pre-wrap;';

    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText =
      'margin-top:6px;border:1px solid #d3d9e0;background:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:#2563eb;';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(field.value);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });

    row.append(label, value, copy);
    body.append(row);
  }

  if (payload.evidence.length > 0) {
    const heading = document.createElement('div');
    heading.textContent = 'Your evidence';
    heading.style.cssText =
      'border-top:1px solid #e2e6eb;padding-top:10px;margin-top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;';
    body.append(heading);

    for (const item of payload.evidence) {
      const link = document.createElement('a');
      link.href = item.downloadUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `Download ${item.label}`;
      link.style.cssText = 'display:block;font-size:13px;color:#2563eb;margin-top:6px;';
      body.append(link);
    }

    const note = document.createElement('p');
    // Browsers do not let a script populate a file input, and that is correct.
    note.textContent = 'Attach these yourself — CivicSOS cannot put files into the site’s upload box for you.';
    note.style.cssText = 'font-size:11px;color:#64748b;margin-top:8px;';
    body.append(note);
  }
}

function createPanel(): HTMLElement {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  // Shadow DOM so the portal's stylesheet cannot restyle the panel, and ours
  // cannot leak into their page.
  const shadow = host.attachShadow({ mode: 'closed' });

  const card = document.createElement('div');
  card.style.cssText =
    'width:330px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #e2e6eb;border-radius:14px;' +
    'box-shadow:0 6px 16px rgba(23,32,51,.12);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:14px;';

  const title = document.createElement('div');
  title.textContent = 'CivicSOS assistant';
  title.style.cssText = 'font-size:14px;font-weight:600;color:#172033;';

  const status = document.createElement('p');
  status.setAttribute('data-civicsos', 'status');
  status.style.cssText = 'font-size:12px;color:#64748b;margin:6px 0 4px;line-height:1.5;';

  const guarantee = document.createElement('p');
  guarantee.textContent = 'CivicSOS never submits for you and never handles your login.';
  guarantee.style.cssText =
    'font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 8px;margin:6px 0;';

  const body = document.createElement('div');
  body.setAttribute('data-civicsos', 'body');

  const close = document.createElement('button');
  close.textContent = 'Dismiss';
  close.style.cssText =
    'margin-top:10px;width:100%;border:1px solid #d3d9e0;background:#f7f8fa;border-radius:9px;padding:7px;font-size:12px;cursor:pointer;color:#3d4a5c;';
  close.addEventListener('click', () => host.remove());

  card.append(title, status, guarantee, body, close);
  shadow.append(card);
  document.documentElement.append(host);
  return card;
}
