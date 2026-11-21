#!/usr/bin/env node
// Accessibility check of the server-rendered HTML of a RUNNING build (axe-core on jsdom):
//   pnpm --filter @670send/web a11y          (BASE=http://localhost:3100 by default)
// Colour contrast needs real layout, so it is covered separately by src/lib/contrast.test.ts on the design tokens.
import axe from 'axe-core';
import { JSDOM } from 'jsdom';

const BASE = (process.env.BASE ?? 'http://localhost:3100').replace(/\/$/, '');
const LOCALES = ['tet', 'pt', 'en', 'id'];
// The 404 page is not listed: Next.js 16 serves a bare shell for it and renders the page after hydration,
// so raw-HTML analysis says nothing about it (checked in a real browser instead: lang, heading, landmarks).
const PAGES = ['', '/calculator', '/track', '/book', '/prohibited', '/terms'];

let failures = 0;
for (const locale of LOCALES) {
  for (const page of PAGES) {
    const url = `${BASE}/${locale}${page}`;
    const html = await (await fetch(url)).text();
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.eval(axe.source);
    const res = await dom.window.axe.run(dom.window.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      resultTypes: ['violations'],
    });
    const label = `${locale}${page || '/'}`;
    if (res.violations.length === 0) console.log(`  ✓ ${label}`);
    else {
      failures += res.violations.length;
      for (const v of res.violations) console.error(`  ✗ ${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×) e.g. ${v.nodes[0]?.html.slice(0, 120)}`);
    }
    dom.window.close();
  }
}
console.log(failures ? `\n${failures} accessibility violation(s)` : '\nNo accessibility violations found');
process.exit(failures ? 1 : 0);
