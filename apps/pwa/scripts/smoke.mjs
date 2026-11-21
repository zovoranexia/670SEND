#!/usr/bin/env node
// Checks the BUILT app (run `pnpm --filter @670send/pwa build` first):  pnpm --filter @670send/pwa smoke
// A PWA fails in ways unit tests cannot see: an invalid manifest, a missing icon, a service worker that caches
// API calls (stale money!), or a first load too heavy for a provincial connection.
import { existsSync, readFileSync } from 'node:fs';
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

/* ------------------------------------------------------------------------------------------- manifest */
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));
check(manifest.name === '670Send Field' && manifest.short_name === '670Send', 'manifest names');
check(manifest.display === 'standalone' && manifest.start_url === '/' && manifest.scope === '/', 'standalone, start_url and scope are "/"');
check(manifest.theme_color === '#0B4F5C' && manifest.background_color === '#0B4F5C', 'brand colours');
check(manifest.lang === 'tet', 'default language is Tetun');
const pngSize = (file) => {
  const b = read(file);
  return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
};
for (const icon of manifest.icons) {
  const [w, h] = icon.sizes.split('x').map(Number);
  const actual = existsSync(path.join(dist, icon.src)) ? pngSize(icon.src) : null;
  check(actual && actual[0] === w && actual[1] === h, `icon ${icon.src} is a real ${icon.sizes} PNG${icon.purpose ? ` (${icon.purpose})` : ''}`);
}
check(manifest.icons.some((i) => i.purpose === 'maskable'), 'has a maskable icon (Android adaptive icons)');
check(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'), 'has the 192 and 512 icons Chrome needs to offer installation');
check(existsSync(path.join(dist, 'icons/apple-touch-icon.png')) && pngSize('icons/apple-touch-icon.png')?.[0] === 180, 'Apple touch icon 180×180');

/* ------------------------------------------------------------------------------------------ index.html */
check(/<html lang="tet"/.test(html), '<html lang> is set');
check(/viewport-fit=cover/.test(html), 'viewport-fit=cover (notch / safe areas)');
check(/rel="manifest"/.test(html), 'links the manifest');
check(/name="theme-color"/.test(html) && /rel="apple-touch-icon"/.test(html), 'theme colour and Apple touch icon');
check(!/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:/.test(html), 'no third-party scripts, styles or fonts (works on a weak connection, no tracking)');

/* ------------------------------------------------------------------------------------ service worker */
const sw = read('sw.js').toString('utf8');
check(/index\.html/.test(sw), 'service worker precaches the app shell (index.html)');
check(/NavigationRoute|createHandlerBoundToURL/.test(sw), 'offline navigation falls back to the shell');
check(!/\/v1\//.test(sw) && !/registerRoute\([^)]*api/i.test(sw), 'the service worker does NOT cache API calls (money, OTPs and stock come from the server, always)');
check(!/skipWaiting\(\)\s*;?\s*self\.clients|self\.skipWaiting\(\)/.test(sw.replace(/addEventListener\("message"[\s\S]*?\}\)/, '')), 'an update waits for the agent to tap "Update" (never reloads mid drop-off)');
for (const asset of [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1])) check(sw.includes(asset), `precached: ${asset}`);

// Registered at start-up, not after sign-in: otherwise a first-time visitor never gets the offline shell cached.
const entry = html.match(/<script[^>]+type="module"[^>]+src="\/(assets\/[^"]+\.js)"/)?.[1];
check(entry && /serviceWorker/.test(read(entry).toString('utf8')), 'the entry bundle contains the service-worker registration');
// WHEN it is called matters: the first version registered it only inside the signed-in screens.
const mainSrc = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main.tsx'), 'utf8');
check(/registerServiceWorker\(\)/.test(mainSrc) && mainSrc.indexOf('registerServiceWorker()') < mainSrc.indexOf('createRoot('), 'main.tsx registers the service worker at start-up, before React renders (so a first visit already caches the shell)');

/* ---------------------------------------------------------------------------------------- first load */
const firstLoad = [...new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
const gz = (f) => gzipSync(read(f)).length;
const total = firstLoad.reduce((s, f) => s + gz(f), 0);
const BUDGET = 260 * 1024;
check(total <= BUDGET, `first load ${(total / 1024).toFixed(0)} KB gzipped (budget ${BUDGET / 1024} KB)`);
check(!firstLoad.some((f) => /jsQR/.test(f)), 'the QR-decoder fallback (jsQR, 47 KB) loads only when a scanner opens');
const screens = ['ReceiveWizard', 'Inbound', 'Handover', 'Wallet', 'Parcels', 'Profile', 'HubHandover'];
check(screens.every((s) => existsSync(path.join(dist, 'assets')) && [...firstLoad].every((f) => !f.includes(s))), 'secondary screens are separate chunks');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
