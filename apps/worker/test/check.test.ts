import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { runCheck } from '../src/check.js';
import type { StatusCheckRequest } from '@civicsos/core';

/**
 * The worker's refusals, tested.
 *
 * Everything this container claims about itself — that it stops at a login
 * wall, that it types only the citizen's reference, that it presses only the
 * lookup control — is a claim about code paths that do not exist. These tests
 * are how that stays true: they drive `runCheck` against a fake page and assert
 * on what it did and, more importantly, what it did not do.
 *
 * No real browser here on purpose. Launching Chromium to test a refusal would
 * make the refusal slower to verify and no better verified.
 */

const REQUEST: StatusCheckRequest = {
  caseId: 'case_1',
  ownerId: 'citizen-alice',
  targetId: 'CIVICSOS_PRACTICE',
  officialReference: 'SWM/2026/118472',
};

interface FakePageOptions {
  /** Selectors that should report as visible. */
  visible?: string[];
  /** Selectors that exist in the DOM at all. */
  present?: string[];
  resultText?: string;
}

/** Records everything the worker touched, so the test can assert on absence. */
interface Trace {
  filled: Array<{ selector: string; value: string }>;
  clicked: string[];
  navigatedTo: string[];
  contextsClosed: number;
}

function fakeBrowser(options: FakePageOptions): { browser: Browser; trace: Trace } {
  const present = new Set(options.present ?? ['#status-reference', '#status-lookup', '#status-result']);
  const visible = new Set(options.visible ?? []);

  const trace: Trace = { filled: [], clicked: [], navigatedTo: [], contextsClosed: 0 };

  const locator = (selector: string) => ({
    first: () => ({
      count: async () => (present.has(selector) ? 1 : 0),
      isVisible: async () => visible.has(selector),
      fill: async (value: string) => {
        trace.filled.push({ selector, value });
      },
      click: async () => {
        trace.clicked.push(selector);
      },
      waitFor: async () => {
        if (!present.has(selector)) throw new Error('not present');
      },
      innerText: async () => options.resultText ?? '',
    }),
  });

  const page = {
    setDefaultTimeout: () => undefined,
    goto: async (url: string) => {
      trace.navigatedTo.push(url);
    },
    locator,
  };

  const browser = {
    newContext: async () => ({
      newPage: async () => page,
      close: async () => {
        trace.contextsClosed += 1;
      },
    }),
  } as unknown as Browser;

  return { browser, trace };
}

const options = { baseUrl: 'https://example.invalid', now: () => new Date('2026-03-10T00:00:00.000Z') };

describe('the worker stops rather than acting', () => {
  it('reports NEEDS_HUMAN at a sign-in wall and touches nothing', async () => {
    const { browser, trace } = fakeBrowser({ visible: ['#status-signin'] });

    const result = await runCheck(browser, REQUEST, options);

    expect(result.outcome).toBe('NEEDS_HUMAN');
    // The important half: it did not type, and it did not click.
    expect(trace.filled).toEqual([]);
    expect(trace.clicked).toEqual([]);
  });

  it('reports NEEDS_HUMAN at a CAPTCHA and touches nothing', async () => {
    const { browser, trace } = fakeBrowser({ visible: ['#status-challenge'] });

    const result = await runCheck(browser, REQUEST, options);

    expect(result.outcome).toBe('NEEDS_HUMAN');
    expect(trace.filled).toEqual([]);
    expect(trace.clicked).toEqual([]);
  });

  it('re-checks for a gate that appears only after the lookup', async () => {
    // Some portals challenge on submit rather than on load. Reading whatever
    // is on screen at that point would mean parsing a CAPTCHA page as a status.
    const { browser } = fakeBrowser({ visible: [], resultText: 'Status: Resolved' });
    let lookupDone = false;

    const gated = {
      ...browser,
      newContext: async () => ({
        newPage: async () => ({
          setDefaultTimeout: () => undefined,
          goto: async () => undefined,
          locator: (selector: string) => ({
            first: () => ({
              count: async () => 1,
              isVisible: async () => selector === '#status-challenge' && lookupDone,
              fill: async () => undefined,
              click: async () => {
                lookupDone = true;
              },
              waitFor: async () => undefined,
              innerText: async () => 'Status: Resolved',
            }),
          }),
        }),
        close: async () => undefined,
      }),
    } as unknown as Browser;

    const result = await runCheck(gated, REQUEST, options);
    expect(result.outcome).toBe('NEEDS_HUMAN');
  });

  it('refuses a target that is not in the registry', async () => {
    // The worker takes a target id, never a URL, so nothing upstream can talk
    // it into visiting a site nobody verified.
    const { browser, trace } = fakeBrowser({});

    const result = await runCheck(browser, { ...REQUEST, targetId: 'SOMEWHERE_ELSE' }, options);

    expect(result.outcome).toBe('UNREADABLE');
    expect(trace.navigatedTo).toEqual([]);
  });
});

describe('the worker reads what it came for', () => {
  it('types only the reference, and clicks only the lookup control', async () => {
    const { browser, trace } = fakeBrowser({ resultText: 'Status: Registered — in progress' });

    const result = await runCheck(browser, REQUEST, options);

    expect(result.outcome).toBe('IN_PROGRESS');
    // Exactly one field, carrying exactly the citizen's own reference.
    expect(trace.filled).toEqual([{ selector: '#status-reference', value: 'SWM/2026/118472' }]);
    // Exactly one click, and it is the lookup — there is no submit here to press.
    expect(trace.clicked).toEqual(['#status-lookup']);
  });

  it('resolves a relative target against the configured base URL', async () => {
    const { browser, trace } = fakeBrowser({ resultText: 'Status: Resolved' });

    await runCheck(browser, REQUEST, options);

    expect(trace.navigatedTo).toEqual(['https://example.invalid/practice-portal/status']);
  });

  it('carries no scraped text when it could not classify the page', async () => {
    // Unvetted third-party prose must not reach the citizen dressed up as a
    // status, so the label travels only alongside an outcome we understood.
    const { browser } = fakeBrowser({ resultText: 'Welcome to the portal' });

    const result = await runCheck(browser, REQUEST, options);

    expect(result.outcome).toBe('UNREADABLE');
    expect(result.observedLabel).toBeUndefined();
  });

  it('reports UNREADABLE rather than throwing when the page has changed shape', async () => {
    // One portal redesigning overnight must not take the rest of the batch
    // down with it.
    const { browser } = fakeBrowser({ present: ['#status-result'] });

    const result = await runCheck(browser, REQUEST, options);
    expect(result.outcome).toBe('UNREADABLE');
  });

  it('always closes its browser context', async () => {
    const { browser, trace } = fakeBrowser({ visible: ['#status-signin'] });
    await runCheck(browser, REQUEST, options);
    expect(trace.contextsClosed).toBe(1);
  });
});
