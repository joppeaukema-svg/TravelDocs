# TravelDocs — Travel Companion

An offline-first travel companion for one long trip: documents, bookings, visas, insurance and emergency info in one
place, checked against each country's entry rules and linked to official sources. It is an installable web app
(PWA): no app store, no account, no server holding your data.

**Status:** Phase 2 — on top of phase 1 (offline shell, encrypted vault, documents, insurance, emergency card, backup):
trip import/export, stays with counters, time-zone-aware bookings, timeline with gap detection, the rules engine
(section 7 of the brief, 14 rules), prep checklists and the `.ics` calendar export with alarms.

## Privacy

- Everything you enter stays on the phone, in the browser's IndexedDB. Nothing is sent anywhere.
- **Vault:** document titles, numbers, notes and files, personal and medical details and insurance details are
  encrypted with AES-256-GCM. The key is random; it's wrapped with a key derived from your passphrase
  (PBKDF2-SHA256, 600,000 iterations) and only ever unwrapped into memory. The vault locks after 5 minutes without use
  (configurable) and shortly after the app goes to the background — but not while you're picking a photo or file.
- **Readable without the passphrase** (so warnings and the emergency card work while locked): document types and
  expiry dates, the fields you choose for the emergency card, insurance coverage limits, settings.
- **Backups** are one encrypted file with everything. They open with the passphrase that was in use when you made them.
  There is no reset: a forgotten passphrase means the vault and its backups can't be opened.
- The repository holds code, public content and fake demo data only. `my-trip.json`, the brief and backup files are
  in `.gitignore`, and a test fails if a private trip file is ever committed.
- Strict Content Security Policy, self-hosted fonts, no third-party scripts.

## On your phone

The app is served from GitHub Pages once deployed (see *Deploying*).

**iPhone (Safari, iOS 16.4+):** open the site in Safari → Share → *Add to Home Screen* → open it from the home screen.
Installing matters on iOS: Safari may clear data of websites you haven't used for a while, but not of home-screen apps.

**Android (Chrome):** open the site → menu (⋮) → *Install app* (or *Add to Home screen*).

Then, in the app:

1. **Docs** → create the vault with a passphrase you won't forget (four random words work well). Store it in your
   password manager.
2. Add your passport: *Camera* for a photo, *Photos* for an existing picture, *Files* for PDFs.
3. **More → Insurance**, **More → Personal details**, then **More → Emergency card** to choose what the card shows.
4. **More → Backup & restore** → *Create backup* → *Share / Save* to your own cloud drive or email.
5. Test airplane mode: switch it on, close the app fully, reopen it — every screen should work.

To move to a new phone: install the app there, then **Backup & restore → Choose backup file** and enter the
passphrase.

## Trip, rules and reminders

- **Trip → Import trip file** reads `my-trip.json` (`travel-companion-trip/1`). Anything that doesn't validate is
  listed and left out; the rest is imported. After that the app is the source of truth — **Export** writes the same
  format back.
- The rules engine (`src/rules/`) is a set of pure functions over the itinerary. All rule parameters — stay limits,
  passport validity, forms and their windows, e-visa ports, booking windows, crossings, holidays — live in
  `content/rules.json`, each with sources and a `verifiedAt` date. Change a rule by editing that file; the tests check
  that every rule still has a source.
- **Checklists** holds a “before you leave” list and one prep list per country. Items whose moment has passed show as
  **Do now**; tick them off, snooze them or mark them not needed.

### Calendar reminders (.ics)

**Trip → Calendar with prep reminders** exports one event per prep moment, with an alarm in the time zone you'll be
in, never between 22:00 and 08:00 (earlier alarms ring the evening before). Every event links back to its checklist.

- **iPhone:** open the file → *Add All* → pick a separate calendar, e.g. a new “Trip prep” calendar.
- **Android / Google Calendar:** calendar.google.com → Settings → *Import* → choose the file and a “Trip prep” calendar.

When the plan changes, replace the old import: delete the “Trip prep” calendar (iPhone: Calendars → ⓘ → Delete
Calendar; Google: Settings → the calendar → Remove) and import the new file into a fresh one. Event IDs are stable, so
Google Calendar also updates events when you re-import into the same calendar.

## Development

Needs Node 22.

```sh
npm install
npm run dev          # http://localhost:5173 (no service worker, no CSP)
npm run check        # typecheck + lint + unit tests
npm run build && npm run preview   # production build on http://localhost:4173
npm run e2e          # Playwright, phone viewports (Pixel 7 on Chromium, iPhone 13 on WebKit)
```

If WebKit isn't installed, run the iPhone profile on Chromium: `PW_IPHONE_BROWSER=chromium npm run e2e`. To use an
existing Chromium binary: `PW_CHROMIUM_EXECUTABLE=/path/to/chromium`.

### Demo trip

`demo/trip.demo.json` is a copy of a real itinerary with every date moved by a random number of weeks and all notes
removed. Regenerate it from a private trip file with `npm run demo-trip -- my-trip.json`. The offset isn't stored
anywhere.

### Content

Country content lives in `content/countries/{cc}.json` (one file per country, plus `global.json`). Every fact and
emergency number needs at least one source URL and a `verifiedAt` date; `unverified: true` shows a warning in the app.
Adding a country means adding a file — the app picks it up automatically.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. One-time setup:
*Settings → Pages → Build and deployment → Source: GitHub Actions*. GitHub Pages on a free account needs a public
repository.

## Layout

```
content/          country content (sourced facts, emergency numbers)
demo/             anonymised demo trip
scripts/          icon and demo-trip generators
src/app/          shell, routing, header, tabs
src/crypto/       key derivation, AES-GCM
src/vault/        vault session, encrypted records and files, auto-lock
src/backup/       backup file format
src/docs/         documents and image import
src/profile/      personal details and insurance
src/emergency/    emergency card
src/trip/         trip format, import/export, storage, time zones
src/rules/        rules engine, prep scheduling, .ics
src/features/     screens
tests/unit/       Vitest (one test file per rule group)
tests/golden/     the brief's golden trip test (demo trip; also my-trip.json when present locally)
tests/e2e/        Playwright
```
