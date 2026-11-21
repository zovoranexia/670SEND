#!/usr/bin/env node
// Smoke test of a RUNNING build:  pnpm --filter @670send/web build && pnpm --filter @670send/web start  (other terminal)
//                                 pnpm --filter @670send/web smoke            (BASE=http://localhost:3100 by default)
// Checks, for every language × page: 200, <html lang>, localized <title>, one <h1>, hreflang for all 4 + x-default,
// canonical, no untranslated key leaking into the text, no <script> from foreign origins, security headers.
const BASE = (process.env.BASE ?? 'http://localhost:3100').replace(/\/$/, '');
const LOCALES = ['tet', 'pt', 'en', 'id'];
const PAGES = ['', '/calculator', '/track', '/book', '/prohibited', '/terms'];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('  ✗ ' + msg);
};

const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');

const titles = new Map();
for (const locale of LOCALES) {
  for (const page of PAGES) {
    const url = `${BASE}/${locale}${page}`;
    const res = await fetch(url, { redirect: 'manual' });
    const html = await res.text();
    const label = `${locale}${page || '/'}`;
    let ok = true;
    const check = (cond, msg) => {
      if (!cond) {
        ok = false;
        fail(`${label}: ${msg}`);
      }
    };

    check(res.status === 200, `status ${res.status}`);
    check(new RegExp(`<html[^>]*lang="${locale}"`).test(html), 'wrong <html lang>');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    check(title.length > 3, 'empty <title>');
    titles.set(label, title);
    check((html.match(/<h1[\s>]/g) ?? []).length === 1, `expected exactly one <h1>, found ${(html.match(/<h1[\s>]/g) ?? []).length}`);
    for (const l of [...LOCALES, 'x-default']) check(new RegExp(`<link[^>]+rel="alternate"[^>]+hrefLang="${l}"|<link[^>]+hrefLang="${l}"[^>]+rel="alternate"`, 'i').test(html), `missing hreflang ${l}`);
    check(new RegExp(`<link[^>]+rel="canonical"[^>]+href="[^"]*/${locale}${page}"`).test(html), 'canonical does not point to itself');
    const visible = text(html);
    const leaked = visible.match(/\b(?:web|common|status|errors|terms|prohibited)\.[a-zA-Z]+(?:\.[a-zA-Z_0-9]+)+\b/g);
    check(!leaked, `untranslated keys visible: ${leaked?.slice(0, 3).join(', ')}`);
    check(/href="#main"/.test(html) && /id="main"/.test(html), 'skip link / main landmark missing');
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) check(m[1].startsWith('/'), `script from another origin: ${m[1]}`);

    for (const [h, expected] of [
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
    ])
      check(res.headers.get(h) === expected, `header ${h} = ${res.headers.get(h)}`);
    const csp = res.headers.get('content-security-policy') ?? '';
    check(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("default-src 'self'"), 'CSP incomplete');

    if (ok) console.log(`  ✓ ${label}`);
  }
}

// The four languages must really differ (catches "all pages render Tetun" bugs).
for (const page of PAGES) {
  const set = new Set(LOCALES.map((l) => titles.get(`${l}${page || '/'}`)));
  if (set.size !== LOCALES.length) fail(`${page || '/'}: <title> is identical in several languages`);
}

// Routing behaviour
const redirect = async (path, headers = {}) => {
  const r = await fetch(BASE + path, { redirect: 'manual', headers });
  return { status: r.status, location: r.headers.get('location'), cookie: r.headers.get('set-cookie') };
};
const checks = [
  ['/ → Tetun even for an English browser', await redirect('/', { 'Accept-Language': 'en-US,en;q=0.9' }), (r) => r.status === 307 && r.location === '/tet'],
  ['/ → remembered language (cookie)', await redirect('/', { Cookie: '670send_lang=pt' }), (r) => r.status === 307 && r.location === '/pt'],
  ['legacy WhatsApp link keeps its query', await redirect('/track?no=670S-DIL-BCU-261121-0042'), (r) => r.status === 307 && r.location === '/tet/track?no=670S-DIL-BCU-261121-0042'],
];
for (const [name, r, ok] of checks) (ok(r) ? console.log(`  ✓ ${name}`) : fail(`${name}: ${JSON.stringify(r)}`));

const notFound = await fetch(`${BASE}/tet/no-such-page`);
notFound.status === 404 ? console.log('  ✓ unknown page → 404') : fail(`unknown page → ${notFound.status}`);
const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
(sitemap.match(/<url>/g) ?? []).length === LOCALES.length * PAGES.length ? console.log('  ✓ sitemap lists every page in every language') : fail('sitemap incomplete');
const robots = await (await fetch(`${BASE}/robots.txt`)).text();
robots.includes('Sitemap:') ? console.log('  ✓ robots.txt') : fail('robots.txt without sitemap');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
