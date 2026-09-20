import type { Browser } from 'playwright-core';
import {
  classifyStatusText,
  getStatusCheckTarget,
  type StatusCheckOutcome,
  type StatusCheckRequest,
  type StatusCheckResult,
  type StatusCheckTarget,
} from '@civicsos/core';

/**
 * Reading one public status page.
 *
 * This is the only part of CivicSOS that drives a browser against a page it
 * does not control, so it is written to be boring and to give up early.
 *
 * Four rules, enforced here rather than promised:
 *
 *  1. It only ever visits a URL from the verified target registry. It cannot be
 *     handed a URL, because it does not accept one — only a `targetId`.
 *  2. It types exactly one value: the citizen's own complaint reference. There
 *     is no code path that fills anything else.
 *  3. When a login wall or a challenge is on screen it reports NEEDS_HUMAN and
 *     leaves. It does not attempt either, and has no capability to.
 *  4. It presses the lookup control and nothing else. The registry has no
 *     notion of a submit button, so there is none to press.
 *
 * It returns an observation. It has no database access and no authority over
 * case state — the deterministic rules in the core decide what an observation
 * means.
 */

/** A page that has not answered in this long is not going to. */
const NAVIGATION_TIMEOUT_MS = 20_000;
const LOOKUP_TIMEOUT_MS = 15_000;

/** Status text is untrusted input. Cap it before it travels anywhere. */
const MAX_OBSERVED_LABEL = 160;

/**
 * Identifies CivicSOS honestly.
 *
 * A civic tool that disguises its traffic to look like a person is a civic tool
 * that has decided the site operator should not get to say no. The operator
 * should be able to see us in their logs and block us if they want to.
 */
export const USER_AGENT =
  'CivicSOS-StatusCheck/1.0 (+https://github.com/yugh88/civicSOS; checks a citizen\'s own complaint status)';

export interface CheckOptions {
  /** Base origin for a relative target URL — the practice portal's host. */
  baseUrl: string;
  now: () => Date;
}

function truncate(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_OBSERVED_LABEL ? `${flat.slice(0, MAX_OBSERVED_LABEL)}…` : flat;
}

function resolveUrl(target: StatusCheckTarget, baseUrl: string): string {
  // A registry entry may be relative (the practice portal, which moves with the
  // deployment) or absolute (a real portal, which does not).
  return target.url.startsWith('http') ? target.url : new URL(target.url, baseUrl).toString();
}

/**
 * Runs one check and always resolves — never throws.
 *
 * A worker that crashes on a malformed page would take the whole batch with it,
 * and one unreadable portal must not stop the others from being checked.
 */
export async function runCheck(
  browser: Browser,
  request: StatusCheckRequest,
  options: CheckOptions,
): Promise<StatusCheckResult> {
  const checkedAt = options.now().toISOString();
  const finish = (outcome: StatusCheckOutcome, observedLabel?: string): StatusCheckResult => ({
    caseId: request.caseId,
    targetId: request.targetId,
    outcome,
    observedLabel,
    checkedAt,
  });

  const target = getStatusCheckTarget(request.targetId);
  // Refusing an unknown target is the whole point of taking an id rather than
  // a URL: nothing upstream can talk this worker into visiting a new site.
  if (!target) return finish('UNREADABLE');

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    // No storage state, ever. The worker carries no session from anywhere and
    // leaves none behind — there is nothing here that could become a credential.
    storageState: undefined,
    javaScriptEnabled: true,
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(LOOKUP_TIMEOUT_MS);

    await page.goto(resolveUrl(target, options.baseUrl), {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    // Check the gates before touching anything. A login wall is not an error
    // and not a failure — it is the site saying this is a job for the citizen.
    if (await isVisible(page, target.loggedOutSelector)) return finish('NEEDS_HUMAN');
    if (await isVisible(page, target.challengeSelector)) return finish('NEEDS_HUMAN');

    const referenceField = page.locator(target.referenceSelector).first();
    if ((await referenceField.count()) === 0) return finish('UNREADABLE');

    // The one and only value this worker types anywhere.
    await referenceField.fill(request.officialReference);

    const lookupButton = page.locator(target.lookupSelector).first();
    if ((await lookupButton.count()) === 0) return finish('UNREADABLE');
    await lookupButton.click();

    // A gate can appear *after* the lookup — some portals challenge on submit.
    // Re-check rather than reading whatever is on screen.
    if (await isVisible(page, target.loggedOutSelector)) return finish('NEEDS_HUMAN');
    if (await isVisible(page, target.challengeSelector)) return finish('NEEDS_HUMAN');

    const resultNode = page.locator(target.resultSelector).first();
    try {
      await resultNode.waitFor({ state: 'visible', timeout: LOOKUP_TIMEOUT_MS });
    } catch {
      return finish('UNREADABLE');
    }

    const text = (await resultNode.innerText()).trim();
    const outcome = classifyStatusText(target, text);

    // The label travels only when we actually understood the page. Shipping
    // scraped prose for an outcome we could not classify would put unvetted
    // third-party text in front of the citizen as if it meant something.
    return finish(outcome, outcome === 'UNREADABLE' ? undefined : truncate(text));
  } catch {
    // Timeouts, navigation failures, a page that changed shape overnight.
    // All the same from here: we did not get an answer.
    return finish('UNREADABLE');
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function isVisible(page: { locator: (selector: string) => { first: () => { isVisible: () => Promise<boolean> } } }, selector?: string): Promise<boolean> {
  if (!selector) return false;
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}
