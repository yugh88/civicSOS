#!/usr/bin/env node
/**
 * Worker build.
 *
 * Bundles the worker and the slice of `@civicsos/core` it uses into one file,
 * so the container ships application code plus exactly two runtime packages
 * (Playwright and the EventBridge client) rather than a whole workspace.
 *
 * It also re-checks the practice target's selectors against the page they
 * describe, for the same reason the extension build does: a selector that has
 * silently stopped matching turns a "verified" read into a confident wrong
 * answer, and a wrong status is worse than no status.
 */

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist');

function verifyPracticeTarget() {
  const page = resolve(here, '../web/src/app/practice-portal/status/page.tsx');
  const targets = resolve(here, '../../packages/core/src/status-check/targets.ts');

  let markup;
  try {
    markup = readFileSync(page, 'utf8');
  } catch {
    throw new Error(`The practice status page is missing: ${page}. Remove its target or restore the page.`);
  }

  const source = readFileSync(targets, 'utf8');
  const block = source.slice(source.indexOf('const PRACTICE_TARGET'), source.indexOf('export const STATUS_CHECK_TARGETS'));
  const selectors = [...block.matchAll(/'#([a-z-]+)'/g)].map((match) => match[1]);

  if (selectors.length === 0) throw new Error('No selectors found in the practice status target.');

  const missing = selectors.filter((id) => !markup.includes(`'${id}'`) && !markup.includes(`"${id}"`));
  if (missing.length > 0) {
    throw new Error(
      `The practice status target points at ids that no longer exist on the page: ${missing.join(', ')}.\n` +
        'Fix the selectors, or the worker will report a status it never actually read.',
    );
  }

  console.log(`Verified ${selectors.length} practice status-page selectors against the page.`);
}

verifyPracticeTarget();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Native browser bindings and the AWS SDK stay as real packages.
  external: ['playwright-core', '@aws-sdk/*'],
  // ESM interop for CommonJS deps pulled in transitively.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  sourcemap: false,
  minify: false,
});

console.log(`Built the CivicSOS status-check worker into ${out}`);
