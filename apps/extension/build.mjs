#!/usr/bin/env node
/**
 * Extension build.
 *
 * Bundles the three TypeScript entry points with the esbuild that
 * `@civicsos/infra` already depends on, so this workspace adds no new
 * dependency of its own beyond Chrome's types.
 */

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist');

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
