# @670send/web — the public site (`670send.tl`)

Next.js 16 (App Router) · next-intl 4 · Tailwind CSS 4 · Leaflet. Four languages everywhere — **Tetun (`tet`, default and fallback)**, Portuguese, English, Indonesian — with the translations shared with the API through `@670send/i18n` (one source of truth, parity-tested).

| Page | Path | What it does |
|------|------|--------------|
| Landing | `/{lang}` | Hero with a quick tracker, the four service schemes, how it works, trust points, the 14 municipalities by corridor |
| Rate & canal calculator | `/{lang}/calculator` | **Live** price from the real tariff (`POST /v1/public/quote`): total, breakdown, ETA, and which fleet carries it (bus baggage, cargo, sea ferry for Ataúro / Oecusse) |
| Tracker | `/{lang}/track?no=670S-…` | Public waybill tracker: masked names, the 9-state timeline, exception banners, the destination kiosk with a map link |
| Pick-up booking | `/{lang}/book` | Request a courier pick-up with a pin on the map (`POST /v1/public/pickup-bookings`) |
| Prohibited items · Terms | `/{lang}/prohibited` · `/{lang}/terms` | Same texts the kiosk app shows, server-rendered, no JavaScript needed |

## Run it

```bash
cp apps/web/.env.example apps/web/.env.local     # NEXT_PUBLIC_API_URL must point at a running API
pnpm --filter @670send/web dev                    # http://localhost:3100  (3101 = PWA, 3102 = admin are reserved)
```

The API must list this origin in `CORS_ORIGINS` (the root `.env.example` already has `http://localhost:3100`).

Production: `pnpm --filter @670send/web build && pnpm --filter @670send/web start` — the build is `output: 'standalone'`; `scripts/start.mjs` copies the static assets next to it and runs `server.js` (the Phase 8 Docker image does the same). `PORT` (default 3100) and `WEB_HOST` (default 0.0.0.0) configure it.

## Verify it

```bash
pnpm --filter @670send/web test      # 85 unit / component tests (jsdom, real translations, stubbed API)
pnpm --filter @670send/web start &   # then, against the running production build:
pnpm --filter @670send/web smoke     # 24 pages: status, lang, title, h1, hreflang, canonical, no leaked keys, security headers, routing
pnpm --filter @670send/web a11y      # axe-core (WCAG 2.2 A/AA + best practice) on the server-rendered HTML of every page
```

## How it is built (decisions worth knowing)

* **Languages live in the URL** (`localePrefix: 'always'`): clean `hreflang`, shareable links, no cache confusion. `/` redirects to **Tetun** for every first-time visitor — the browser's `Accept-Language` is deliberately ignored (`src/proxy.ts`), because Timorese browsers are often set to English although the person reads Tetun. Once a visitor picks a language, the `670send_lang` cookie remembers it. The switcher keeps the current page *and* query (the waybill being tracked).
* **WhatsApp links open in the reader's language**: the API now builds `…/{lang}/track?no=…` per recipient. Old `/track?no=…` links still work (redirected with their query).
* **Typed translation keys** (`src/global.d.ts`): a typo'd key fails the build. Tetun fills any hole in another language at runtime.
* **The browser talks to the API directly**, so the API's per-IP rate limit applies to the real visitor, not to this server. Errors come back already translated (`X-Lang`) and are shown as they are.
* **The calculator mirrors the API's limits** (`src/lib/calculator.ts`) so a form it accepts is never refused for format, and keeps every route on Díli: change one end to a province and the other end snaps to Díli. A stale slow answer can never overwrite a newer price (requests are aborted).
* **Low-bandwidth friendly**: statically generated pages, system fonts (no font download), the map library loads **only** on the booking page, the mobile menu and language menu are plain `<details>` elements (work without JavaScript), and the quick tracker on the landing page is a plain GET form.
* **Accessibility**: skip link, one `<h1>` per page, labelled fields with `aria-describedby` errors, `aria-live` results, focus moved to the first invalid field, keyboard-usable map (the address field is the primary way to say where; the pin is optional), `prefers-reduced-motion`. Colours are tested against WCAG AA (`src/lib/contrast.test.ts` reads the real tokens); the logo orange (`#E6511A`, 3.7:1) is decorative only — text and buttons use `accent-600` (5.2:1).
* **Security headers** (`next.config.ts`): CSP limited to this site, the API origin and the tile server; `frame-ancestors 'none'`; `nosniff`; strict referrer policy; HSTS in production; `geolocation=(self)` only. `script-src` keeps `'unsafe-inline'` because Next.js injects small inline scripts and a per-request nonce would make every page dynamic (no CDN caching).
* **Look & motion** (`src/components/fx/`, `globals.css`): teal/orange brand tokens, glass cards, a logo **splash** (the mark and wordmark draw themselves stroke by stroke, then the overlay fades out) and **parallax** layers (glows, route network, floating parcels, mountain ridges) on the hero, banners and bands, plus scroll reveals and a scroll-linked "how it works" line. All of it is decorative: server-rendered and CSS-timed (the splash can never get stuck; it is shown once per browser session, tracked in `sessionStorage` by a tiny inline script), parallax uses one shared passive scroll listener + `requestAnimationFrame` and only touches `transform`, reveals fall back to visible if scripts never run, and everything is switched off under `prefers-reduced-motion`. Parallax layers are always `aria-hidden` — never put content in them.
* **Booking abuse protection**: server-side rate limit, a hidden honeypot field, double-submit blocked while sending. The confirmation shows only the booking reference; the phone number is never echoed back unmasked.
* **Privacy**: no cookies except the language preference, no analytics, no third-party scripts or fonts. The only third party is the map tile server (receives the visitor's IP and the viewed area, only on the booking page).

## Things to know before launch

* **Map tiles**: the default is the public OpenStreetMap server — fine for development and light traffic, but its usage policy forbids production load. Set `NEXT_PUBLIC_MAP_TILE_URL` (and `…_ATTRIBUTION`) to your own tile server or a provider; the CSP follows the setting automatically at build time.
* `NEXT_PUBLIC_*` values are compiled in: changing the API URL needs a rebuild.
* `NEXT_PUBLIC_SUPPORT_WHATSAPP` is empty by default and the footer link is hidden until you set a real number.
* Translations (Tetun and Portuguese especially, plus the legal texts) should be reviewed by a native speaker before launch.
* Next.js 16 answers an unknown URL with a real **404 status** and a bare HTML shell; the localized "page not found" renders once the browser has hydrated (verified in a real browser). Without JavaScript that one page is blank.
* `AGENTS.md` in this folder is generated by Next.js (it points coding assistants to the version-matched docs in `node_modules/next/dist/docs`).
