#!/usr/bin/env node
/**
 * Extension build.
 *
 * Bundles the three TypeScript entry points with the esbuild that
 * `@civicsos/infra` already depends on, so this workspace adds no new
 * dependency of its own beyond Chrome's types.
 */

import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist');

/**
 * The practice-portal mapping is only honest while its selectors still match
 * the page. Rename an id in `page.tsx` and the mapping would keep claiming to
 * be verified while quietly filling nothing — so the build refuses instead.
 *
 * Only this mapping can be checked here; a real portal's selectors live on
 * someone else's server, which is exactly why none are shipped unverified.
 */
function verifyPracticePortalMapping() {
  const page = resolve(here, '../web/src/app/practice-portal/page.tsx');
  const mappings = resolve(here, 'src/mappings.ts');

  let markup;
  try {
    markup = readFileSync(page, 'utf8');
  } catch {
    throw new Error(`The practice portal page is missing: ${page}. Remove its mapping or restore the page.`);
  }

  const source = readFileSync(mappings, 'utf8');
  const block = source.slice(source.indexOf('const PRACTICE_PORTAL'), source.indexOf('export const PORTAL_MAPPINGS'));
  const selectors = [...block.matchAll(/'#([a-z-]+)'/g)].map((match) => match[1]);

  if (selectors.length === 0) throw new Error('No selectors found in the practice-portal mapping.');

  const missing = selectors.filter((id) => !markup.includes(`'${id}'`) && !markup.includes(`"${id}"`));
  if (missing.length > 0) {
    throw new Error(
      `The practice-portal mapping points at ids that no longer exist on the page: ${missing.join(', ')}.\n` +
        'Fix the selectors, or the assistant will report a verified fill that filled nothing.',
    );
  }

  console.log(`Verified ${selectors.length} practice-portal selectors against the page.`);
}

verifyPracticePortalMapping();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/content.ts'), resolve(here, 'src/background.ts')],
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  minify: true,
  // Source maps stay out of a distributed extension.
  sourcemap: false,
});

cpSync(resolve(here, 'manifest.json'), resolve(out, 'manifest.json'));

console.log(`Built the CivicSOS assistant into ${out}`);
console.log('Load it in Chrome: Extensions -> Developer mode -> Load unpacked -> select that folder.');
