#!/usr/bin/env node
// Checks the BUILT console (run `pnpm --filter @670send/admin build` first):  pnpm --filter @670send/admin smoke
// Unit tests cannot see these: a console that loads third-party code, ships every screen in the first download,
// is indexable by search engines, or has lost the brand assets.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

if (!existsSync(dist)) {
  console.error('No dist/ folder: build first.');
  process.exit(1);
}
const read = (f) => readFileSync(path.join(dist, f));
const html = read('index.html').toString('utf8');

/* ------------------------------------------------------------------------------------------ index.html */
check(/<html lang="tet"/.test(html), '<html lang> is set (Tetun default)');
check(/name="viewport"/.test(html), 'viewport meta');
check(/name="robots" content="noindex, nofollow"/.test(html), 'not indexable by search engines (back office)');
check(/name="referrer" content="no-referrer"/.test(html), 'no referrer leaks to the signed URLs of photo evidence');
check(!/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:/.test(html), 'no third-party scripts, styles or fonts');
check(existsSync(path.join(dist, 'favicon.svg')) && existsSync(path.join(dist, 'logo-reversed.svg')), 'brand assets are in the build');

/* --------------------------------------------------------------------------------------------- bundles */
const assets = readdirSync(path.join(dist, 'assets'));
const firstLoad = [...new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
const gz = (f) => gzipSync(read(f)).length;
const total = firstLoad.reduce((s, f) => s + gz(f), 0);
const BUDGET = 330 * 1024; // sign-in screen + shell + translations; every area loads on demand
check(total <= BUDGET, `first load ${(total / 1024).toFixed(0)} KB gzipped (budget ${BUDGET / 1024} KB)`);

const areas = ['Dashboard', 'Shipments', 'Hubs', 'Partners', 'Finance', 'Claims', 'Tariffs', 'Templates', 'Access', 'Audit'];
for (const a of areas) check(assets.some((f) => f.startsWith(`${a}-`) && f.endsWith('.js')), `${a} is its own chunk`);
check(areas.every((a) => firstLoad.every((f) => !path.basename(f).startsWith(`${a}-`))), 'no area is part of the first download');
check(!firstLoad.some((f) => /qrcode/i.test(f)) && assets.some((f) => /^Hubs-/.test(f)), 'the QR generator ships with the hub console only');

/* ------------------------------------------------------------------------------------- source guarantees */
const src = (f) => readFileSync(path.resolve(import.meta.dirname, '..', 'src', f), 'utf8');
check(!/localStorage\.setItem\([^)]*(token|refresh)/i.test(src('lib/session.ts')), 'tokens are never written to localStorage');
check(/sessionStorage/.test(src('lib/session.ts')), 'the session lives in sessionStorage (ends with the tab)');
check(/Idempotency-Key/.test(src('lib/api.ts')), 'the API client can send idempotency keys');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
