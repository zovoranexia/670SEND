# @670send/pwa — the field app (`app.670send.tl`)

An installable web app (PWA) for the people who touch the parcels: **670Link kiosk agents, couriers and fleet drivers**. React 19 · Vite 7 · Tailwind 4 · `use-intl` · React Router 7 · Workbox. Four languages everywhere — **Tetun (default and fallback)**, Portuguese, English, Indonesian — from the same dictionaries as the API and the public site (`@670send/i18n`).

One app, three working modes. The tabs and screens follow the roles of the signed-in user:

| Role | Tabs | What they do |
|------|------|--------------|
| **Agent** (kiosk) | Home · Receive Parcel · Inbound · Hand Over Parcel · Profile (+ Parcels, Wallet) | **5-step drop-off wizard** (KYC → prohibited items + 2 photos → weight/size → price, insurance, canal → PIN), print the receipt, **scan inbound** master bags from the driver, **OTP proof of delivery**, parcels list / reprint, wallet and top-up requests |
| **Courier** | Jobs · Receive Parcel · Hub Handover · Profile (+ Parcels, Wallet) | Assigned **pick-ups** (call / WhatsApp / map, "collect" opens the wizard pre-filled from the booking), **deliveries** (start, hand over with OTP, "could not deliver"), availability switch, **hand-over to the hub** |
| **Driver** | My trips · Profile | Open a trip by tapping or **scanning the manifest QR**, check the load, **baggage-compartment photo** (mandatory for buses), start the trip, record arrival, **confirm incidents** digitally |

Fleet owners and back-office users who sign in here are told this app is not for them (and can sign out) — they use the web portal / admin console.

## Run it

```bash
cp apps/pwa/.env.example apps/pwa/.env.local      # VITE_API_URL → the API (CORS_ORIGINS must list http://localhost:3101)
pnpm --filter @670send/pwa dev                    # http://localhost:3101  (strict port; web = 3100, admin = 3102)
pnpm --filter @670send/pwa build && pnpm --filter @670send/pwa preview     # production build + service worker
```

The camera, Web Bluetooth and the service worker need a **secure context**: `localhost` works; on a phone you need HTTPS (Phase 8 sets it up behind Nginx). Sign in with the +670 mobile number and the 6-digit PIN.

## Verify it

```bash
pnpm --filter @670send/pwa test      # 110 tests (jsdom, real translations, stubbed API)
pnpm --filter @670send/pwa build && pnpm --filter @670send/pwa smoke
                                     # manifest, icons, offline shell, "no API calls cached", first-load budget
```

## Decisions worth knowing

* **Registering a parcel is safe on a bad connection.** The request carries an `Idempotency-Key` that belongs to the *payload*: a retry after a timeout re-sends the same key (the server replays the first answer — the customer is never charged twice), a server refusal (e.g. not enough deposit) starts a new request, and going back to edit after an ambiguous failure first **checks the agent's recent parcels** — if the lost request did reach the server the app shows that parcel instead of letting it be registered again. The PIN is never stored (not even hashed).
* **Camera photos are compressed on the phone.** Decoded with the camera's rotation, shrunk to ≤ 1600 px and re-encoded as JPEG until ≈ 900 KB (hard limit 2 MB, the API cap). Measured in a real browser: **5.9 MB photos → 797 KB**. Re-encoding also strips EXIF (kiosk GPS position, device model) from the stored evidence.
* **Printing (58 mm):** the server renders the receipt (32 columns, CP858, QR) in the *sender's* language; the app streams the ESC/POS bytes over **Web Bluetooth** (Chrome/Edge on Android) in small chunks, finds the writable characteristic among the usual vendor UUIDs, falls back to 20-byte writes if a printer rejects bigger ones, and reconnects when the printer slept. Where Web Bluetooth does not exist (iPhone, Firefox) the same screen offers the **RawBT** app, the **share sheet / WhatsApp**, and copy. A "print test page" lives in the profile.
* **Scanning:** the native `BarcodeDetector` where the phone has one, otherwise `jsQR` (a separate 47 KB chunk loaded only when a scanner opens). It reads waybills, master bags and manifests (also from a tracking link) and refuses anything this screen cannot use. **Typing the code always works** — cameras fail.
* **Language is saved to the user's profile** (`PATCH /auth/me/language`), so every phone someone signs in on uses it; on sign-in the profile wins. Offline, the language still changes on this phone and a notice says the profile could not be updated yet. The login screen has the four language buttons because a new user may not read Tetun.
* **Offline:** the shell (HTML, JS, CSS, icons) is precached at the **first visit, before sign-in**, so the app opens with no signal. API calls are **never cached** (money, OTPs and stock must come from the server) and there is **no offline write queue** on purpose: a drop-off needs the live waybill sequence, the PIN check and the wallet debit. Instead the UI says "this needs a connection" plainly and every money-moving request is safe to retry.
* **Updates never interrupt work:** a new version downloads in the background and waits; the agent taps **Update** between parcels.
* **Session:** access token (15 min) in memory only; the rotating refresh token and profile in `localStorage`. Trade-off documented in `src/lib/session.ts`: script running in this origin could read it, which is why the app ships no third-party scripts and the recommended CSP below. A refresh token that the server revoked ends the session with a message; being offline during a refresh does **not** sign anyone out. Parallel requests share one refresh (a second use of a rotated token would look like theft).
* **Unfinished parcels survive** a reload or a phone call (kept in `sessionStorage`, cleared on sign-out); the app asks whether to continue or start over.
* **Small first load:** 185 KB gzipped (budget 260 KB); the less-used screens are lazy chunks and the libraries sit in their own long-lived chunks, so an update re-downloads only the app code.
* **Accessibility for field use:** 48 px touch targets, 16 px text (no zoom on focus), labelled fields with `aria-describedby` errors, focus moved to the first problem, live regions for results, reduced-motion respected; the same AA-checked palette as the public site.

### Recommended headers for `app.670send.tl` (Phase 8 puts them in Nginx)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.670send.tl; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Permissions-Policy: camera=(self), geolocation=(), microphone=(), bluetooth=(self)
Cache-Control: no-cache   (for /sw.js, /index.html and /manifest.webmanifest;  /assets/* may be immutable)
```

## Not verified on real hardware yet

* **Bluetooth printing was tested against a faithful fake** (chunking, retry with smaller writes, reconnect, error mapping) **but not on a physical 58 mm printer** — please test with the printers the kiosks will really use; UUIDs for other models are one line in `src/lib/printer.ts`.
* The camera scanner was tested with a fake video/reader and in a browser without a camera; try it on a phone in poor light.
* The agent and courier flows were driven in a real browser against the real API and database (a throwaway test kiosk and courier, since suspended); the **driver screens are covered by component tests and by API tests**, not by a browser session.
* iOS: the app installs and the camera, QR scanning and sharing are expected to work (not tested on an iPhone), but Safari has no Web Bluetooth and RawBT is Android-only, so receipts there can only be shared or copied.

## Open items

* No push notifications and no background sync yet.
* An offline "queue and send later" for **photos only** (never for money) could be added if connectivity in the provinces turns out to be worse than assumed.
* Only the receipt language and the printer are stored per phone; there are no per-kiosk preferences yet.
