# TravelDocs — Travel Companion

An offline-first travel companion for one long trip: documents, bookings, visas, insurance and emergency info in one
place, checked against each country's entry rules and linked to official sources. It is an installable web app
(PWA): no app store, no account, no server holding your data.

**Status:** Phase 4 — complete: encrypted vault and documents, emergency card, backups (file and paper), trip import
with the entry-rules engine, prep checklists and calendar reminders, sharing with a travel companion, country guides
with sources and the live Dutch travel advice, money (expenses, budgets, converter), weather, phrases, packing and a
demo mode. Phase 5 adds optional push notifications through a tiny sender you host yourself (see *Push
notifications*).

**Just want to look?** Open the app and choose *Try demo mode* on Today or in Settings — a sample trip three weeks in,
with documents, insurance and expenses. It lives in a separate store; *Leave demo* throws it away and brings your own
data back.

## Privacy

- Everything you enter stays on the phone, in the browser's IndexedDB. Nothing is sent anywhere.
- The app downloads the travel advice and exchange rates from its own site (they're published with it daily), so
  those requests say nothing about you. **Weather is off by default**: turning it on sends the names of your current
  and next stop — no dates, nothing else — to Open-Meteo.
- **Push notifications are off by default** and only exist if you set up the sender. Turning them on sends your
  phone's push address and a list of times with titles like “Laos prep: 3 tasks due” to that sender — no names,
  documents, bookings or places beyond the country. Turning them off deletes it there.
- **Vault:** document titles, numbers, notes and files, personal and medical details and insurance details are
  encrypted with AES-256-GCM. The key is random; it's wrapped with a key derived from your passphrase
  (PBKDF2-SHA256, 600,000 iterations) and only ever unwrapped into memory. The vault locks after 5 minutes without use
  (configurable) and shortly after the app goes to the background — but not while you're picking a photo or file.
- **Readable without the passphrase** (so warnings and the emergency card work while locked): document types and
  expiry dates, the fields you choose for the emergency card, insurance coverage limits, the itinerary, expenses,
  settings.
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

## Backups

- **Backup file** (More → Backup & restore): one encrypted file with everything — vault, documents and their files,
  trip, checklists, expenses, settings. Keep it off the phone (your own cloud drive or email). Today reminds you when
  the last backup is more than 7 days old. Restoring replaces everything on the phone with the backup's contents and
  needs the passphrase that was in use when it was made.
- **Paper backup** (More → Paper backup): one page with the Dutch 24/7 numbers, your insurer and policy number, ICE
  contacts, emergency numbers per country, the Dutch embassies and consulates, your itinerary and booking
  references. *Print or save as PDF*. Unlock the vault first to include insurance and ICE details; document numbers
  are only included when you switch them on. Keep the printout apart from your passport.

## Money

More → Money: log expenses in any of the route's currencies with a category and country; the EUR value is fixed with
the rate of the day you enter it. Set a daily budget per country to see today's spending and each country's average
per day against it. **CSV** exports everything for a spreadsheet. The **converter** works offline with the last
downloaded rates, and you can set your own rate per currency.

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

## Push notifications

Browsers can't schedule notifications on their own, so real reminders need a small sender. It lives in `push/`: a
Cloudflare Worker (no dependencies) that stores each phone's push subscription and `{time, title, link}` entries, and
every 5 minutes sends what's due, encrypted end-to-end to the phone (Web Push, RFC 8291/8292). The app keeps the
schedule up to date whenever the trip or a checklist changes; reminders never fall between 22:00 and 08:00 local time,
and tapping one opens that country's checklist. Without a sender everything else still works, and the calendar export
gives the same reminders as alarms.

**Setting up the sender** (once; needs a free Cloudflare account):

1. `npm run vapid-keys` — prints a public and a private key.
2. In `push/wrangler.toml`, put the public key in `VAPID_PUBLIC_KEY` and check `ALLOWED_ORIGIN` (your Pages origin).
3. In `push/`:
   ```sh
   npx wrangler@4 login
   npx wrangler@4 kv namespace create SUBS      # paste the id into wrangler.toml
   npx wrangler@4 secret put VAPID_PRIVATE_KEY  # paste the private key
   npx wrangler@4 deploy                        # prints https://travel-companion-push.<you>.workers.dev
   ```
4. On GitHub: *Settings → Secrets and variables → Actions → Variables → New variable* `PUSH_URL` = that URL, then
   re-run the *Deploy to GitHub Pages* workflow. The build adds the URL to the app and its Content Security Policy.

**On the phone:** iPhone needs the app on the Home Screen (iOS 16.4+) — Safari won't offer push in a normal tab.
Open **Settings → Notifications**, switch *Push notifications* on, allow notifications, then *Send a test
notification*. Android (Chrome) works from the installed app or the browser. Push is disabled in demo mode.

The free Cloudflare plan is plenty for this: one cron run every 5 minutes and a handful of storage operations a day.
The private key only lives in the Worker's secrets; don't commit it.

## Travelling together

Two people each use the app on their own phone and share the trip, without accounts or a server:

1. One of you: **Trip → Travelling together → Create a trip code**, then **Prepare trip to send** → **Send as
   message** (WhatsApp, Signal, iMessage, email). The trip travels as an encrypted block of text, so chat apps don't
   mangle it. Tell the other person the trip code in person — it is never sent with the trip.
2. The other: install the app, copy the whole message, **Trip → Receive a shared trip**, paste it, type the code.
3. You link once: both phones keep the trip code. It is not a live connection — after changes, either of you sends
   again (Prepare → Send) and the other receives it the same way. **Travelling together** shows the link, when you last
   sent and received, and how many changes on this phone haven't been sent; Today reminds you too. The newest edit of each stay or
   booking wins, and deletions carry over.

What is shared: stays, bookings marked **Both of us**, the day plan and trip dates. What never leaves the phone: the
vault (documents, passport, insurance, personal details), the emergency card, profile, checklist ticks, the date
stamped in your passport, documents linked to a booking, bookings marked **Just me** and each booking's **private
note**.

## Country guides and live data

Countries → a country has tabs for entry and forms, safety and the live advice, emergency (numbers and the Dutch
embassy or consulates), health, money, transport, connectivity, laws and culture, phrases, apps and sources. Every
fact shows its sources and the date it was checked; facts that only a traveller guide or reference site backs are
marked **unverified**. More → Sources lists everything, with the date the live data was downloaded.

- **Travel advice and embassies:** `npm run sync-live` fetches the Dutch government's open data (CC0) and exchange
  rates into `public/live/`. `.github/workflows/sync-live.yml` does this daily at 04:17 UTC, commits only real
  changes and then redeploys. The app stores the last copy for offline use. When the advice for a country still ahead
  on your route changes after you've read it, Today and the guide say so and the changed sections are marked.
- **Money:** converter for EUR, CNY, JPY, VND, THB, LAK, PHP and USD with the last downloaded rates; set your own rate
  per currency.
- **Weather:** More → Weather. 7-day forecast for where you are and your next stop (from the places per day in your
  trip), plus seasonal notes.
- **Phrases:** key phrases with romanisation and read-aloud where the phone has a voice; full-screen cards for your
  address (taken from the accommodation's local address when the booking has one), "use the meter", "where is the
  hospital?" and allergies. Not checked by native speakers — the English is always shown too.
- **Packing:** Checklists → Packing, with destination items for the countries on your route, each linked to the fact
  that explains it.

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
anywhere. Demo mode moves it again (by whole weeks) so that today is about three weeks into the trip, and adds
made-up documents, insurance and expenses; its vault passphrase is `demo demo demo`. Open `…/?demo` to start the app
straight in demo mode.

### Updating content and rules

- **A country fact:** edit `content/countries/{cc}.json`. Each fact has an `id`, `topic` (entry, forms, safety,
  emergency, health, laws, money, transport, connectivity, culture, weather, holidays, apps), a short `title` and
  `body`, optional `severity` (info, important, critical), `sources` and `verifiedAt`. Prefer the Dutch government
  advice and official portals; never cite visa agencies. Can't confirm it officially? Keep it with
  `"unverified": true`.
- **An entry rule:** edit `content/rules.json` — stay limits (`stayRegimes`), passport validity, onward tickets,
  e-visa ports, arrival forms and their windows, booking windows, border crossings, holidays, driving, and the
  pre-departure and per-country prep templates. Every rule points at entries in its `sources` map, each with a
  `verifiedAt` date. `npm run check` validates the file and the golden trip test shows the effect on the demo trip.
- **Live data** (advice, embassies, rates) updates itself daily; to refresh by hand run `npm run sync-live` or start
  the *Sync live data* workflow on GitHub.
- Run `npm run verify-sources` now and then, and re-check anything older than 30 days.
- Content ships with the app: commit and push to `main`, and phones pick it up the next time the app opens online.

### Adding a country

1. Create `content/countries/{cc}.json` with `country` (ISO alpha-2), `iso3`, `name`, `timeZone` (IANA),
   `currency`, `adviceUrl` (its NederlandWereldwijd page), `emergencyNumbers` and `facts` — copy an existing file as
   the template.
2. Add its official links to `content/sources.json`.
3. Add its rules to `content/rules.json`: at least a `stayRegimes` entry and a `passport` entry, plus forms, e-visa
   ports and driving rules where they apply. Add an `nl-advice-{cc}` source.
4. Optional: a language in `content/phrases.json` (every phrase, card and allergen needs a translation — the tests
   check) and destination items in `content/packing.json`.
5. Add the currency to `CURRENCIES` in `src/features/money/Converter.tsx` if it's new.
6. `npm run sync-live` (fetches its advice, embassies and exchange rate), `npm run check`, `npm run e2e`, commit.

### Content

Country content lives in `content/countries/{cc}.json` (one file per country, plus `global.json`). Every fact and
emergency number needs at least one source URL and a `verifiedAt` date; `unverified: true` shows a warning in the app.
Adding a country means adding a file — the app picks it up automatically. Also in `content/`: `sources.json`
(official links per country and topic), `rules.json` (entry-rule parameters), `phrases.json` and `packing.json`.

`npm run verify-sources` checks that every source URL still responds and lists items checked more than 30 days ago
and everything marked unverified. Government sites often block scripts or time out from data centres; those show as
*check by hand* rather than broken.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. One-time setup:
*Settings → Pages → Build and deployment → Source: GitHub Actions*. GitHub Pages on a free account needs a public
repository.

## Layout

```
content/          country facts, official links, rules, phrases, packing template
public/live/      travel advice, embassies, rates and maps (written by the daily sync)
demo/             anonymised demo trip
scripts/          live-data sync, source checker, icon and demo-trip generators
src/app/          shell, routing, header, tabs
src/crypto/       key derivation, AES-GCM
src/vault/        vault session, encrypted records and files, auto-lock
src/backup/       backup file format
src/docs/         documents and image import
src/profile/      personal details and insurance
src/emergency/    emergency card
src/trip/         trip format, import/export, storage, time zones
src/rules/        rules engine, prep scheduling, .ics
src/live/         live data: schema, refresh, what you've read, own rates
src/weather/      Open-Meteo forecasts
src/money/        expenses and budgets
src/demo/         demo mode (separate database, sample data)
src/push/         push schedule, subscription and sync
push/             the push sender (Cloudflare Worker)
src/features/     screens
tests/unit/       Vitest (one test file per rule group)
tests/golden/     the brief's golden trip test (demo trip; also my-trip.json when present locally)
tests/e2e/        Playwright
```
