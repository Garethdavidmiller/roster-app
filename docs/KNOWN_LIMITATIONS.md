# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: November 2026 — v27.00 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

**Every entry says four things:** what goes wrong · who notices (or that nobody would) · the
workaround · the planned fix, or the decision not to fix and whose it was. The reasoning a module
header already holds is pointed at, not copied.

Every heading here should read as **still true today**. When an item closes, delete it — git holds
it — and keep any durable lesson in the module header or contract that owns it, and any decision in
`DECISIONS.md`. `doc-parity.test.mjs` fails on a heading that reads as closed. How each item came to
be is in git (the items closed before 25 Nov 2026 are in `git show 28b217d0:docs/ROADMAP_HISTORY.md`).

---

## Left open by the full check of 3 November 2026 — each an owner decision

The bug, regression and technical-debt check of 3 Nov 2026 fixed what was plainly broken. These it
left, each for a decision rather than a default:

- **Weight.** `.git` was about 1.4 GB on 3 Nov 2026; sixteen committed copies of the Links 26 pack zip
  added ~15 MB each. The zip is now built on demand and untracked (owner, 3 Nov 2026 —
  `docs/links-26/tooling/pack.py`), and `docs/links-24` (its own 13 MB zip) was removed on 7 Nov 2026
  (owner: no longer of use; `git checkout 924b9dbc -- docs/links-24` restores it). Both stay in
  history: rewriting it was ruled out. What the Links tests and tooling still read was moved first
  (`test-fixtures/links-designs/`, `docs/links-26/tooling/reference-24/`,
  `docs/links-26/tooling/default-baseline.mjs`).
- **Size.** Several modules sit exactly at their cap in `coordinator-ratchet.test.mjs`, and the
  largest stylesheets in `stylesheet-ratchet.test.mjs`. A file at its cap takes the next feature only
  by extracting something first; raising a cap in passing is not the answer (the ratchet's header).
- **Typed colours.** The coloured `rgb()`/`rgba()` literals left in the stylesheets — nearly all a
  navy shadow tint — are a ratchet that may only go down (`RGB_BASELINE` in `css-hex-parity.test.mjs`).
- **Overtime stays paused** (owner, 3 Nov 2026). Its page, Cloud Functions and tests are kept and keep
  running in CI so it can be switched back on; removing it was offered and declined.
  `OVERTIME_AVAILABILITY.md` → Paused says what is switched off.

## The Pages mirror costs every cold load 21% more bytes (measured 5 Sep 2026)

GitHub Pages serves the app's JS/CSS with **gzip** where Firebase Hosting serves **brotli**. Across the
Calendar's 52 critical-path files: `myb-roster.web.app` **339 KB**, the Pages mirror **409 KB**.

- **Who notices:** nobody by eye — the staff on the mirror (most of them) pay it on every cold load and
  after every release.
- **Workaround / fix:** none in this repo; GitHub Pages chooses its own encoding and takes no headers.
  It prices the changeover to the canonical URL: `ROADMAP.md` → Address migration campaign.

## The deploy gate can flake, and a failed deploy does not retry itself

`e2e.yml`'s `unit` job and `deploy-hosting.yml`'s `check` job run the identical `npm run check`, and a
deploy has failed it once while the same commit's pull request passed (Aug 2026: one unit test, not
reproduced in nine local runs, never named — the log was too large to fetch and its tail held only
passes). Staff stay on the previous release meanwhile.

- **Who notices:** the `deploy-failure` issue (`.github/actions/report-deploy-failure`, whose header
  says why an issue and why repeats comment). The reporter needs the deploy job and every gate before
  it, with `if: failure() || contains(needs.*.result, 'cancelled')`, so setup failures and timeouts
  are reported too (`workflow-hygiene.test.mjs` holds the shape). An outage that takes down
  `checkout` or the action itself takes the reporter with it; nothing inside a workflow can report that.
- **Workaround:** if it recurs, **pull the log promptly** — the one chance to name the test — then run
  the workflow on `main` (Actions → Run workflow). Do the same when a documentation-only commit
  (`paths-ignore`) would otherwise leave production stale; a re-run of an old run stops itself once a
  newer one exists.
- **Decision:** `npm run check` stays single-shot — a retry would hide a flake and give an intermittent
  product bug a second chance to reach staff. Playwright retries once in CI and reports it as `flaky`.

### The `webkit` job is intermittently red, and only a few of its tests gate a release

The whole WebKit lane runs in branch CI only; it is not in `deploy-hosting.yml`, because every release
would wait for its slowest shard and a WebKit-only flake would keep staff on a stale version. Since
17 Nov 2026 the deploy's `safari` job runs every page opening and the signed-in journeys' iPhone half
instead (DECISIONS.md → "A few Safari tests gate the release"). Merging with `webkit` red and the rest
green is designed behaviour unless the merge ruleset requires it (OPERATIONS_REFERENCE.md → "The Pages
mirror", step 1).

- **Measured flake** (Aug 2026): one test failing 1 run in 6 locally, and no overlap between the
  failing sets of two CI runs on one commit — covered by one retry in CI (`playwright.webkit.mjs`).
- **How to read red:** an engine difference fails both attempts, so **a red `webkit` means something**.
  Different failing names between runs ⇒ flake; the same test failing again ⇒ investigate.
- **A pass on retry can still be a real bug** (14 Nov 2026): the day panel's focus test failed about one
  run in five, and the cause was the app — a lightbox closed before its first frame ran that frame
  afterwards (`createLightbox`, `overlay.js`). Before calling a test a flake, give it one run that logs.
- **A long flow on this engine is split, not given more time** (15 Nov 2026): at a desktop width on the
  Links page each change to the page costs WebKit a 300–450 ms frame, measured, and Playwright waits
  two frames before each click — one test spent 35–58 s of its 60 that way while the app answered in
  under 40 ms. It became two tests (`e2e/links.spec.js`).

## Two editors on one day: warned whenever the server can be asked

Every manual record has one fixed id per member and date (`manualOverrideId`, `override-id.js`). Every
Admin save of a day — the week grid's, and a leave or absence range's — reads each day it writes in the
same transaction (`commitChecked`, `admin-override-store.js`) and refuses the whole save, naming the
days, unless each still holds what the page showed; a delete compares every field and the revision
(`sameOverrideRecord`, `override-compare.js`). Each check first waits for this device's own unsent
saves (`whenOwnWritesSentFor`). The weekly import (`saveRosterWrites`, `roster-import-save.js`) checks
every record it DELETES the same way; a part that only adds is a plain batch. A manual record always
outranks an import, so only a deletion can lose a colleague's edit.

**What still goes wrong — each deliberate, each to revisit if a lost edit is reported from it.**
Nobody is told in any of these; the later save simply stands.

- **Offline, the later save still wins.** A save made offline, whose check could not reach the server
  (Firestore tries for about eight seconds), or whose own earlier saves have not gone within eight
  seconds, is held as a batch and sent unchecked. A save that REMOVES a day is never held: offline it
  is refused, writing nothing.
- **A colleague who made exactly the same change is still a colleague** — their name is on the record,
  so the save is refused rather than counted as done.
- **A long range booking** (only a long absence needs more than one commit, about 450 writes each)
  checks part by part; a later part refused after earlier ones landed stops there, says some days are
  saved and refreshes the list. It compares with what the page held when the booking started.
- **The week grid does not see an import that arrives after its row was drawn**: an import record has
  its own id, so a change staged on that day is saved over it without a warning — except a rest day
  whose swapped-day question was answered first, which `planAlWeekSave` (`admin-al-week-save.js`) names.
- **Two imports of the same week at the same time** do not see each other (import records take random
  ids, which a transaction cannot look up without a query). Only the admin imports, so it is two tabs
  of one person.
- **Duplicates from before the fixed ids** clear only when that day is next saved or deleted from Admin
  (the week editor, a range, either Saved Changes delete, or a Recorded Annual Leave / Absence row's ✕);
  an import is never treated as a duplicate. On the capped All-staff list an old day may not be loaded,
  so select the member first. None has been counted (see "Duplicate Firestore override documents").

## Admin saves are slow on iPhones — one cause found, others still being measured

**What goes wrong.** An Admin save sits on "Saving…" past the 8-second notice with full signal, then
arrives (reported Oct 2026 on iPhones, once on Android). The time is spent waiting for Firestore's
server; the notice names the signal only when the browser reports being offline.

**The cause found: another account's unsent write.** A checked save first waits up to
`OWN_WRITES_WAIT_MS` for this device's earlier saves. That wait never ends while ANOTHER account's
unsent write is in Firestore's on-device queue, because the SDK looks up the highest unsent batch
without bounding the search to the signed-in account (getHighestUnacknowledgedBatchId,
`@firebase/firestore` 4.19 to 4.20 — reproduced on the emulators on both engines, held by signed-in
journey 19). The usual source was the retired staff PIN's queued page views. Whether a member is hit
depends on how their account id sorts, which is why it looked like a few people's phones. The first
"ran out" reading of the diagnostic (an installed iPhone, 23 Nov 2026) confirmed it.

**What the app does** (the reasoning is in the headers of `claim-retry.js` and `firebase-client.js`):

- Until the PIN's cleanup release (27 Nov 2026), ending a leftover PIN session first gave its queued
  writes two seconds to leave. With the account deleted they never can, so that went too; the two
  points below are what answers a leftover now.
- When the wait runs out, the save's own records are asked (v26.63, owner's choice of fix, 24 Nov 2026 —
  `ownWritesSentFor`): if none still has a write of THIS account's pending, the transaction goes ahead.
  **The price:** a phone with full bars and no data spends about sixteen seconds before a save is
  held — accepted.
- **Online, every phone asks the records FIRST** (v27.08, owner's choice, 27 Nov 2026), so a leftover
  costs nothing: clear, the save goes straight on, with no wait at all; a record still queued, or one
  the cache cannot answer, waits as before. Offline the wait still comes first. It replaced a per-phone
  note (v26.84, 25 Nov 2026) that still cost every affected phone eight seconds on its first save and
  again weekly. Admin's saves, the roster import and the Links DESIGNS use it. **The price:** this
  account's own unsent write to a record the save does NOT touch is not waited for — the transaction
  never reads that record. The leftover itself stays in the phone's storage, a few harmless bytes.

**Who notices:** the Error Log. Each "Slow save (diagnostic)" entry carries the save's time, the time
**in the background**, a **sign-in token** time, and how the own-saves wait went (`trackOwnWritesWaits`,
`slow-save.js`). Read them in that order: background time first (iOS freezes a backgrounded app and the
clock runs on); then a token taking seconds means auth; a token in milliseconds with a long wait points
at the connection (timing starts at the 8-second mark). When two saves overlap the wait figure can be
the other's ("(2 waits)" counts waits heard). These entries are not counted as unresolved errors
(`DIAGNOSTIC_PREFIX`, `client-errors.js`); the admin's notification counts them apart
(OPERATIONS_REFERENCE.md → "The Error Log notification").

**What is still open:**

- **The fault itself is Firebase's, and is still in `@firebase/firestore` 4.20.0** (Firebase 13.4.0, the
  newest release on 27 Nov 2026 — checked in the published package, and journey 19 still reproduces it).
  Nothing in the app now waits on it. Clearing the leftover from the SDK's storage was offered and not
  chosen (owner, 24 Nov 2026): it edits the SDK's private storage, which an update could change; and the
  SDK's public clear-the-cache function would also discard the member's own unsent saves, which only the
  broken wait could say were there. If a release bounds the lookup to the signed-in account, nothing
  here needs to change.
- **Whether anything else is slow is unmeasured.** Long-polling on iPhones was prepared and not shipped
  (5 Oct 2026: App Speed's data contradicted the premise). The readings so far (Nov 2026) were each just
  past eight seconds, on screen, token 0.0s — the cause above. Read the iPhone entries before choosing
  another fix.

## The iPhone status bar is solid — and was changed without a device to test on

Every page sets `apple-mobile-web-app-status-bar-style` to `black` (`page-contract-parity.test.mjs`),
answering a report from the installed app on the iPhone 18 Pro: under `black-translucent` the header's
logo and title drew blurred under iOS's blurred status bar.

- **Unconfirmed** (no iOS 27 device here): whether an EXISTING home-screen install picks the change up
  without being re-added, and how the solid bar looks against the navy (expected black, a shade off).
- **Fallback if the blur persists on a fresh install:** keep `black-translucent` and push the header
  down instead — a guess at the band's depth.

## iPhones keep two separate copies of what the app stores, and Safari clears one of them

Two iOS behaviours, reported rather than documented by Apple (WebKit bug 181849; WebKit's tracking
prevention), found by the iPhone audit of 7 Nov 2026. Android shares storage between browser and
installed app, so neither applies there.

- **The Home Screen app does not share Safari's storage.** Installed from Safari, it starts with no
  sign-in, no Pay Calculator figures, no notice flags and an empty App Notices list (every Home Screen
  site since iOS 26).
- **A Safari tab loses everything after seven days of Safari use without a visit** — localStorage,
  IndexedDB, the service worker and its caches. The Home Screen app's count moves only on days it opens.

**What it costs, worst first:** Pay Calculator figures (the one thing that cannot be recreated — they
live only in localStorage, by design); the sign-in; the Links staffing-table edits; notice flags (a
notice can come round again); and the Usage counts, which see a tab and an install as two devices.

**Workaround (since 7 Nov 2026):** the install wording on the Calendar and in Settings tells an iPhone
member to copy their figures first with 💾 Move Your Pay Data and that they will sign in again; the Pay
page says figures are kept in this browser; an emptied calculator points at Restore; on an iPhone the
backup goes through the share sheet. **What cannot be done:** move the figures automatically, or
protect a tab-only member who stays away a week. Whether Safari grants `navigator.storage.persist()`
(`requestPersistentStorage`, `ls.js`) and whether that exempts a tab is unknown —
`IPHONE_RELEASE_CHECKLIST.md` has the device check.

## Development-tool advisories that only a downgrade would clear

The ROOT tree is development tooling only (the Firebase CLI, the rules harness, Playwright, ESLint);
nothing in it is served. **Do not trust a count written here; run `npm audit`.** Its shape on
27 Nov 2026 (Firebase CLI 15.36.0, ESLint 10.15.0): moderate findings only, none high or critical.

- **Inside `firebase-tools`** (pubsub, opentelemetry, archiver, gaxios, glob, uuid and neighbours): npm
  offers only `npm audit fix --force`, which DOWNGRADES the CLI a major version — declined. They clear
  as the CLI updates; re-run `npm audit` after each CLI bump. `hono`, under the CLI's MCP SDK, clears
  with a plain `npm audit fix` inside the existing ranges, once the update bot's two-week cooldown
  allows the newer releases.
- **Inside ESLint's own packages** — npm's offer is likewise a major downgrade.
- **`gaxios` (F-DEP-1).** `firebase-tools` declares `gaxios@^6.7.0`; the fix is in `7.x`. **Do not force
  it with `overrides`:** 6→7 is a major API change an intermediate Google dependency is not ready for,
  and it would risk the deploy and emulator toolchain. Close it when `firebase-tools` widens the range:
  bump the CLI, then confirm `npm run test:rules` and a hosting-emulator run.

**Two `overrides` entries are deliberate.** `@grpc/grpc-js` under `@firebase/firestore` is raised to
`^1.14.5` (Firestore's own range is `~1.9.0`); only the rules-emulator suite uses it, and it passes.
**If `npm run test:rules` ever fails to CONNECT after a dependency change, remove that override
first;** drop it once Firestore's range moves past 1.9. And `@napi-rs/canvas` is pinned to `1.1.0`, as
`functions/package.json` does, so an install cannot take a release under two weeks old.
`.github/dependabot.yml` says which dependencies the update bot leaves alone, and why.

## The test matrix and the phones staff carry

Both WebKit lanes run at the iPhone Pro geometry staff carry (`IPHONE_PRO_VIEWPORT`,
`playwright.webkit.mjs`) under the iPhone 13 descriptor. Left out on purpose:

- **The 17 Pro descriptor** — it would change only the user agent's iOS number, which the app never
  reads (`playwright.webkit.mjs`).
- **3x density for the Links specs**: they draw at 2x (`LINKS_IPHONE_DPR`, 12 Nov 2026). A desktop-size
  Links window drew at 6.5–11 frames a second at 3x and every click waits on frames; nothing in Links
  reads the density. Every other iPhone spec stays at 3x.
- **Landscape (874×402, 956×440).** Playwright's Linux WebKit reports every safe-area inset as zero, so
  a baseline would prove nothing about the Dynamic Island. A real iPhone in landscape is a device check.

### The Playwright upgrade — the baselines come from CI's render, not the container's

- **A container's render differs from CI's, even on the same browser build.** At the Playwright 1.63
  upgrade, baselines redrawn in the dev container on CI's Chromium build and Ubuntu 24.04 all failed on
  CI: the container breaks some lines of Inter differently. **When the lane on a pull request disagrees
  with a baseline drawn here, believe the lane**, and take the actuals from that pull request's
  `visual-diffs` artifact (check its digest; `scripts/refresh-visual-baselines.mjs`). It is why the
  update bot leaves `@playwright/test` alone: each release's baselines are redrawn from its own CI
  render, by hand.
- **The repository's Playwright can be ahead of the dev container's browsers** (it is on 26 Nov 2026).
  **Workaround:** launch Chromium with `executablePath: '/opt/pw-browsers/chromium'` from a scratch
  config that imports the project's, with `testDir` and the web server's `cwd` absolute. WebKit takes
  `npx playwright install webkit`, about a minute. CI installs its own browsers.

### Every browser job is pinned to Ubuntu 24.04

GitHub's `ubuntu-latest` moved to 26.04 in late October 2026; every job that starts a browser says
`runs-on: ubuntu-24.04` (the list and reason are on `e2e.yml`'s smoke job). What holds them is the
baselines, which are CI's render on 24.04.

- **Deferred: move them all together**, as their own change, with every baseline redrawn from CI's
  render on the new image. One job left behind would test a browser the others do not.
- **Deferred: `install-browser-deps` reports success when Playwright declines to install.** Its fallback
  exits 0 on an unsupported image, so the failure surfaces at browser launch, hundreds of tests later.
  A launch check would name it at the step; `workflow-hygiene.test.mjs` pins the fallback's shape, so
  the test changes with it.

### Playwright's WebKit crashed on a navigation after a Back — whether Safari on a phone does is unchecked

Playwright 1.56's WebKit crashed on a cross-document navigation after two `history.pushState` calls and
a `history.back()` — the shape of any exit from a dialog opened over the drawer. The repository's
Playwright no longer has the fault (3 Nov 2026). **Open question:** Safari on a phone is not believed
to share it, but nobody has checked. To check: Admin → change a row → ☰ → Calendar → **Leave**.

The Leave test (`e2e/admin-unsaved-work.spec.js`) still stops the navigation with a `204` and asserts
the request — correct on either build. **Never skip such a test on WebKit**: it is the lane's only view
of the dialog, the drawer and the guard on Safari's engine.

## Security

> **Forward plan:** `SECURITY_RELEASE_PLAN.md` — the work still open and the
> ordering that keeps a fix from re-creating the v10.94 outage. **Still deferred:** App Check (Track D,
> below) · password retirement (Track C5, gated on ≥90% migrated **and** Track E —
> `MAINTENANCE_CALENDAR.md` → Trigger points).

### The document FILES are protected by a bearer URL, not by auth

The deployed exception and what closes it are `ARCHITECTURE.md` → EXC-007. While it is open:

- **A permanent tokenised URL bypasses the rules.** Members open documents through a short-lived signed
  URL from `getDocumentUrl` (used only when it names the file on screen — `resolveDocumentOpenUrl`),
  falling back to the stored permanent `storageUrl` (owner decision, DECISIONS.md). Anyone who ever
  held a permanent URL keeps access until the object is deleted or its key rotated. The owner rotated
  every key on 27 Nov 2026, so only a link handed out since then still opens; another press of
  Operations → Document links (OPERATIONS_REFERENCE.md → "Document links — replacing every old copy")
  ends those too.
- **The signed URL depends on one IAM grant** (`roles/iam.serviceAccountTokenCreator` on the runtime
  service account, on itself — RECOVERY_RUNBOOK.md → 5b). Without it every call answers 503 and nobody
  notices, because every open falls back. **Check:** open a document and look for
  `storage.googleapis.com`, not `firebasestorage`, in the address.
- **A stored link can go dead** (a document saved more than a day after its file can miss a key a run
  removed), and a re-sent upload arriving after another for the same date leaves the document naming a
  deleted file. Members still open through the signed link; Document links → Check counts both and
  Replace mends them (`functions/doc-link-rotation.js`).
- **Document retention bounds the exposure, but is not a guarantee.** Huddles go at 3 months
  (`pruneOldHuddles`, `functions/huddle-retention.js`), Circulars and Newsletters at 6
  (`pruneOldDocs`, `doc-retention.js`), and deleting the object kills its URL. **Neither is
  scheduled** — each runs after an upload of its kind, so if uploads stop nothing prunes, and the
  browser sweep refuses to run without server time. A partial failure orphans the Storage object
  (Firestore is deleted first, so nobody sees it, and it still serves its URL); the Huddle sweep
  retries once (`sweepHuddleOrphans`), the other sweep has no such step, and only a Document links run
  switches an orphan's link off. **Planned home:** a scheduled Function.
- **Microsoft reads the Word documents.** `officeViewerUrl` (`storage-utils.js`) hands the SIGNED URL to
  Office Online, which fetches it server-side — kept by owner decision (AUTH_AND_SESSIONS.md → "The document files (E6)", 19 Sep 2026).

### Real payslip figures stay in git HISTORY (owner decision, recorded not accepted)

The pay-maths fixture — thirteen of one colleague's real payslips — is the gitignored
`test-fixtures/payslip-actuals.local.js` since v23.71 (`sw-asset-check.test.mjs` guards the ignore
rule), so the Pages mirror, which serves the repository root, no longer serves it. **It is still in
every commit up to v23.71, and in the SERVED `roster-data.js` before v14.68**: anyone who clones the
public repository can read it, and GitHub has already served it.

- **Decision:** scrubbing declined on cost (the same owner decision) — a `filter-repo` rewrite changes
  every SHA on `main`, breaks clones and every commit link in these documents, and cannot recall bytes
  already served. The same reasoning as the base roster's public classification (AUTH_AND_SESSIONS.md → "Public by decision").
- **What would close it:** making the repository private, which also retires the Pages mirror and so
  waits for the address migration (OPERATIONS_REFERENCE → "Which address staff are on").

### No restore has ever been TESTED — and the portable export is still not set up

PITR and a managed backup schedule are on (confirmed against the live project, 19 Sep 2026). **A backup
nobody has restored from is a belief, not a capability**, and nobody would notice until the day it is
needed.

- **The restore path is written down and unexercised.** A restore lands in a NEW database (`(default)`
  cannot be overwritten), so the sequence is restore → verify → cut over. **Procedure:**
  `RECOVERY_RUNBOOK.md` → "5. Rehearse once" → "6. The RESTORE DRILL" — including the step people
  forget, deleting the scratch database, which bills and is a second copy of everyone's data.
- **The portable GCS export (the runbook's section 3) is not set up.** PITR and managed backups live in
  the same project; an export to Cloud Storage is the copy that survives losing it.
- **Decision pending:** a drill costs money and care, in proportion to a loss PITR has made less likely.
  Not doing it is legitimate; believing it done is not. `MAINTENANCE_CALENDAR.md` has no drill row, and
  adding one is the owner's call.

### Named colleagues' leave figures remain in git history, and no guard classifies `docs/`

The workbook's per-person reconciliation log is the gitignored `docs/AL_WORKBOOK.local.md`, so it is no
longer served; the committed `docs/AL_WORKBOOK.md` keeps the method and worked examples reading
*"a member"*, plus a name-spelling map with no figures (public by `AUTH_AND_SESSIONS.md` → "Public by decision").

- **The log is still in git HISTORY**, as the payslip fixture is; rewriting history is the owner's call
  and has not been taken.
- **A fresh checkout does not carry the log**, so a new session starts without the reconciliation
  history — accepted, reversible by un-ignoring the file.
- **The public classification was reasoned about SHIFT PATTERNS** (on the station's printed rosters). A
  leave balance is not printed, and is a different class of third-party personal data.
- **No guard CLASSIFIES what `docs/` publishes.** `public-data-classification.test.mjs` covers the
  world-readable roster files only. `payroll-anonymity.test.mjs` scans every tracked file for a roster
  name beside a payroll term, a leave balance, or a leave figure or tally within three lines; a new
  personal field that names nobody, or a name beside a word neither vocabulary lists, passes.
- **The leave uploader's file has four locks** (Nov 2026): `scripts/make-leave-file.mjs` will not write
  inside a checkout, `.gitignore` excludes it under every name a copy gets, the commit hook refuses one
  by content, and `leave-file-privacy.test.mjs` fails in CI on a tracked one (format marker and seal).
  The same days copied into a doc without the seal pass both guards.

### A row comment that said too much about a colleague remains in git HISTORY

From v22.41 to 10 November 2026 the comment over one row of the world-readable member table (and
`docs/MAINTENANCE_CALENDAR.md`) said more about that colleague than their roster move. No file carries
it now.

- **Git history keeps it — and so does one commit's SUBJECT line**, which every commit list shows.
  Rewriting either is the owner's call and has not been taken.
- **The guard reads only the member table:** `roster-data.test.mjs` fails on a comment there about a
  person's circumstances. `payroll-anonymity.test.mjs` matches a name and a payroll or balance term on
  ONE line (leave figures within three), which is how this one passed.

### Admin/manager password is surname-derived (F-SEC-1) — the owner chose leave-as-is

Every account's default password is the member's surname (`surnamePassword` — lowercased, letters only,
padded to ≥6), derived from the public display name, so an **admin** or **manager** account still on its
default is guessable by anyone who knows the URL and the convention (the login hint states it).

- **Who notices:** nobody — a guessed sign-in looks like a real one.
- **Fix, one action away:** each account sets its own password in Settings → Password, after which the
  surname no longer works. The master admin account has its own (owner-reported, 25 Jul 2026). The
  **management accounts**, which write any member's leave, absence and shifts on behalf, are what stays
  open; Operations → Account status shows who has migrated — check there, not here.
- **Decision: leave-as-is** (owner, July 2026). A targeted fix (a real secret for those accounts, with a
  `setupRosterAuth` guard) was scoped and not built: impact-high, likelihood-bounded by an unadvertised
  URL and a small known team. The staff-wide replacement is Track C (SECURITY_RELEASE_PLAN.md); the
  surname is not retired until C5.
- **Revisit when** the URL is advertised more widely or the app becomes official Chiltern
  infrastructure: confirm the admin and manager accounts have their own passwords first. Do not treat
  the guessable password as fixed until they have.

### CSP connect-src uses the `https://*.googleapis.com` wildcard — narrowing was tried and reverted

Narrowing it (A6, F-SEC-6) to `firestore` / `identitytoolkit` / `securetoken` / `firebasestorage`
broke the deployed-CSP CI proof (`e2e/csp.spec.js`, the `csp` job): on a real network the SDK reaches
more `*.googleapis.com` hosts (such as `firebaseinstallations.googleapis.com`). The local
`npm run test:csp` was a false pass — behind the dev container's proxy the SDK never reached them.

- **Decision: the wildcard stays.** It admits only Google-owned origins, `script-src 'self'` already
  blocks injected script, and there is no live vector.
- **If narrowing is retried:** capture the COMPLETE host set from a real-network run (every
  `blockedURI` in the CI `csp` job), list exactly those in `firebase.json` and every page's `<meta>`
  (`npm run generate:copies`), and confirm the CI `csp` job, not just a local run, goes green.

### GitHub Pages mirror — CSP via `<meta>`, with two residual header-only gaps

GitHub Pages serves no custom headers, so every page carries a `<meta>` CSP mirroring `firebase.json`'s
(`npm run generate:copies` writes them; `e2e/csp.spec.js` proves them), and a `<meta name="robots">` for
`X-Robots-Tag` (a `robots.txt` cannot work under `/roster-app/`; `sw-asset-check.test.mjs` →
"every served page carries the noindex meta"). A new page needs both metas; the guards say which is
missing. **Residual gaps on the mirror only — accepted, and a reason to retire it:**

1. **`frame-ancestors 'none'` cannot be expressed in a `<meta>`**, and Pages sends no
   `X-Frame-Options`, so the mirror can be framed. Storage partitioning bounds it: a third-party frame
   gets empty storage, so the framed app is signed out.
2. **`Cache-Control: no-cache` is not applied** (Pages sends `max-age=600`); the service worker never
   rewrites a cached file and fetches a miss `no-cache` (`service-worker.js`).

Both close when the mirror is retired.

### localStorage session can be forged for UI access (#14)

The `myb_admin_session` key can be edited in DevTools to show another member's or the admin's UI. It
creates no Firebase identity: write pages need the member's OWN named session, and `overrides` writes
require the BOUND name (`memberName()` — a password sign-in at the name's own email with the server-set
`member` claim, "The member claim", below) or `admin`/`manager`. **Never quote the raw `token.name ==`
form:** copied into a new rule it reopens the self-set display-name hole. Local UI checks are not
security controls; the default password is still the surname, so this is hardening, not full
remediation. Practical risk is low for a small known team. Status of record:
AUTH_AND_SESSIONS.md → "Write isolation (B0–B3)".

### A signed-in session lasts 60 days regardless of use — renewed on each open in the installed app (owner decisions — accepted trade)

`SESSION_MS` in `session.js` is set at sign-in and is the only clock (owner decisions: v20.41 removed
the 7-day inactivity cutoff, v20.47 doubled 30 days to 60). In the app installed on a phone it is
renewed on each open (owner, 26 Nov 2026 — `renewInstalledSession`; AUTH_AND_SESSIONS.md 2), so a
member using it at least every two months never signs in again; a browser tab or desktop keeps the
fixed 60 days. **Do not restore an inactivity cutoff** on the assumption it was load-bearing. `session.test.mjs` pins the properties;
`createdAt` is no second clock, only compared with the member's last reset (`sessionPredatesReset`).

- **What reads FROM this number:** Operations → Usage's "Accounts that have signed in — last 30
  days", which counts sign-ins, not people (`_appendSignInSection`). The forced password step no longer
  does: it asks on an ordinary open too (AUTH_AND_SESSIONS.md → "The forced password overlay"). Do not restore an active-people claim
  unless the window is derived from `SESSION_MS`.
- **Who notices:** a LEAVER whose device holds a session keeps the signed-in *UI* for up to 60 days —
  in the installed app, 60 days from the last renewal, which stops within the hour of their account being
  disabled (a renewal needs a token the server issued within the hour).
  **The real control** is Operations → Staff Login Accounts → tick "Disable accounts for anyone no
  longer on the roster (leavers)" → Set up accounts: the ID token stops refreshing (≤1 hour), every
  read and write fails, and Admin blocks a name that is no longer on the roster. Sign-out, a disabled
  account, revoked credentials and the `CLAIM_EPOCH` sweep all revoke at once. So the timer's length is
  a UX choice, not a security one.

**One interaction to expect on iOS.** `decideAccess` grants `named` only when a live local session is
backed by a **restored Firebase identity** (`calendar-access-core.js`). A device holding the session
without the identity shows the member sign-in card ("This device needs to sign you in again…"); a
silent re-sign-in is tried first and one tap on "Sign in" recovers it. It will generate support
questions, mostly from iPhones — expect it rather than diagnose it. **The cause is NOT Safari's
seven-day rule** (corrected 7 Nov 2026): that deletes all of a site's storage together, so its victim
arrives signed out, not at this card. The likelier route is an IndexedDB read that fails (WebKit closes
IndexedDB connections in hidden pages, and Firebase Auth falls back to localStorage, where no user is
stored) — unconfirmed on a device. What the seven-day rule really costs is "iPhones keep two separate
copies of what the app stores, and Safari clears one of them", above.

### The four v11 security tasks — task #1 still binds; the other three are history

**Task #1 — every domain the app is served from must be in the GCP API-key referrer allowlist.** The
rule, the allowlist and the symptom are `CLAUDE.md` → Project identity (the ⚠️ referrer note), the one
copy; a domain added there goes into `ADMIN_FUNCTION_ORIGINS` in `functions/index.js` in the same
change. **Who notices:** nobody on screen — every Firebase Auth call from a missing domain fails with
nothing naming the cause, as in May 2026. `live-health.yml` catches it on its next run.

Tasks #2–#4 (per-member write isolation, the HPP variable-pay split — now `.claude/rules/paycalc.md`
invariant 6 — and the pay reminder push) shipped; their record is
`git show 28b217d0:docs/ROADMAP_HISTORY.md` → "The four v11 security tasks".

### Deep-review residuals (July 2026) — accepted / inherent, not code-fixable

A max-effort review found no critical, high or security defect. These remain by nature:

- **A native `<select>` has no deterministic height until given one.** `line-height: normal` resolved to
  17px on most loads and 20px on some, on identical code (a visual-baseline flake; a font-load race was
  disproved). Almost every select is now a `select-sheet.js` button; the native-by-decision ones
  (`select-sheet-parity.test.mjs`) carry no tight baseline, so the one-line fix is available and unused.
- **Analytics dynamic-map values can be forged.** `analytics/activeAccounts`, `analytics/origins` and
  `analytics/perf_<month>` hold maps rules cannot iterate, so a signed-in member could write a
  plausible false count. The rules validate shape and block key removal, `pv_` counts are int-checked,
  the App Speed card reads only whole numbers under a million (`perf-stats.js`), and the usage readers
  take a non-number as zero. Admin-only aggregates; App Check territory.
- **`passwordSetAt` vs `resetAt` is a two-system stamp, not atomic.** A sub-second interleave of a
  self-set and a reset can momentarily misreport the "migrated" chip; it self-heals. `resetAt` is also a
  CONTROL (AUTH_AND_SESSIONS.md 23; `signedInSinceLastReset`, `firestore.rules`), so every path that
  restores the surname default writes it FIRST and changes nothing if it cannot.
- **An open Huddle viewer can hold a superseded link.** Two Power Automate runs for one date send one
  push, which carries only `/#huddle`; only a viewer already open keeps the older link.
- **`style-src 'unsafe-inline'`** stays: the app sets inline styles from JS, and script is fully locked
  down. The `firebasestorage.googleapis.com` entry, redundant under the wildcard, is kept for
  readability.

### The App Speed record can fill in a month of many releases — shown, not prevented

Each month's speed counters are ONE Firestore document keyed partly by version, and September 2026
shipped about a hundred versions. Firestore refuses a document over 1 MiB or 20,000 fields, the app
swallows the error (best-effort analytics), and the card would silently stop changing for the month.

- **Who notices:** the card states how full the record is (`perfRecordFullness`), amber from three
  quarters. The counters are exempt from indexing (`firestore.indexes.json`), which removed the nearer
  40,000-index-entry ceiling.
- **Fix, not built:** cheapest is to stop recording the connection class, which every key carries and
  nothing reads (DECISIONS.md → "The App Speed card answers live questions only"); else shard by week,
  or fold old versions into one key. Nothing yet says the limit is near.

### The Usage counts are a trend, and not comparable across v25.00 — accepted

The Usage card review (v25.00, Oct 2026) changed what three figures count, so months either side are
not the same measure:

- **Page views** stopped counting the app's own reload after an update — about one Calendar open in
  seven in September. The card says so under Page popularity while either window it can show predates
  the change, and stops by itself once both are later.
- **"Last 30 days"** counts each member-device on its LATEST active day (`rollingMove`,
  `usage-stats.js`). The old count froze on the first day and missed about 1 in 30 daily users, 1 in 6
  weekly and 1 in 5 monthly (simulated), so the figures and the address bars step up as devices
  update — not growth.
- **The station PC counted** while the staff PIN opened the Calendar; since its retirement (23 Nov 2026)
  the Calendar counts only once a signed-in member is granted access (`calendarAuthReady`).

**Inherent:** a moved count is a `+1` on today and a `-1` on the day it left, in one write; if the
original `+1` was lost, the `-1` lands on a day that never had it, so a negative day bucket in
`activeAccounts` or `origins` is that, not corruption (the card clamps sums at zero). One person on two
devices counts twice, and cleared browser data counts again; the card's ? panel says so.

### The App Speed card's "First appears" cannot mean the roster — inherent

First Contentful Paint is the first pixel of content, which on the Calendar is the **splash** — it has
never measured the roster, and cannot. So the card adds **Usable** (`markPageReady`, `perf-reporter.js`)
and labels `domReady` "Code loaded".

- **"First appears" is still the splash** — kept because it separates a slow network from a slow app.
- **"Usable" is a smaller population:** an open that had to sign in first records none, and Overtime
  skips the mark when its state read fails. The smaller total is not fewer opens.
- **No history before v20.80**, when the metric started.

### Two card-collapse systems — owner decision, not drift-by-accident

The Pay Calculator's cards animate open (`.collapsible-body`, a `max-height` reveal); the other pages'
shared `.card-collapsible-body` is instant. **Who notices:** anyone moving between pages — the same
interaction feels different. **Decision:** left as-is until somebody decides; converging either way
costs something (the `max-height` reveal eases wrongly on short cards; making Pay instant removes a
nicety on the page used most). Do not converge it in a silent sweep.

### A deliberate burst of reset requests can still show who asked recently — bounded, still open

`requestPasswordReset` answers a recorded request and a throttled repeat with the same body, neither
before `RESET_REQUEST_ANSWER_FLOOR_MS` (3 s). A large DELIBERATE burst can still hold a recorded request
on Firestore's locks past the floor while a throttled one meets it (review, 11 Nov 2026 — the claim's
retries are capped at two, hence 3 s not 2 s). **Bounded:** every name probed is recorded as a request
the admin sees, and each name can be probed once in ten minutes. **Fix, deferred:** send the push from a
Firestore trigger so no answer waits on it — a new deployed function, for a release that needs one. App
Check would also blunt it.

### Settings outside the code that nobody has checked from here (sign-in audit, 13 Nov 2026)

The audit could read the code and rules, not the Firebase console. **Email enumeration protection:**
with it off, Firebase's sign-in API can say which roster addresses have accounts. The addresses are
derivable from the public roster, so it tells an outsider little. **Check:** Firebase console →
Authentication → Settings.

### A lost-phone reset still leaves one narrow gap: the surname (sign-in audit, 13 Nov 2026)

Operations → Reset with "Their phone is lost or stolen" ticked sends no notice and deletes every push
record the account owns, and the rules refuse a push record from a sign-in older than the last
`resetAt` (`signedInSinceLastReset`). **The gap:** a reset puts the password back to the surname
default, which the sign-in card's hint names, so for a member who had their own password the finder
gains a door until the member signs in elsewhere and chooses a new one (the outcome asks the admin to
arrange exactly that). Closing it fully needs a "sign out everywhere, keep the password" endpoint —
**declined (owner, 13 Nov 2026)**: DECISIONS.md → "No 'sign out everywhere, keep the password' action".

### Firebase App Check — declined as an immediate action, RETAINED as Track D

> **`SECURITY_RELEASE_PLAN.md` → Track D is authoritative for whether and when.** It is not closed:
> sequenced last, **monitor-first** (log-only, register every domain and debug token, then enforce one
> product at a time), because the silent-failure risk below is real.

App Check (only our own pages may reach Firestore/Storage) was declined as an immediate action:

- It needs client SDK init in `firebase-client.js` wired to a provider (e.g. reCAPTCHA Enterprise) — a
  real code change with its own outage risk, not a console toggle.
- It shares task #1's failure mode: miss a served domain (`web.app`, `firebaseapp.com`,
  `garethdavidmiller.github.io`) or hit a provider hiccup and writes fail silently.
- It gates which clients connect, not what a signed-in client may read; `overrides` reads already need
  a member identity or the admin claim (since 26 Aug 2026).
- The payoff for this threat model (unadvertised app, small known team) is low; the Aug 2026 external
  review recommended it for the telemetry and reset-request paths, the same sequenced-last position.

**Revisit when** the app is advertised more widely or becomes official Chiltern infrastructure.

---

## A Boxing Day day in lieu can move an allowance THREE years on, and the save checks look at two — from Christmas 2028

Which year a worked Boxing Day's day in lieu is spent in is a CHAIN (`boxingDayLieuYear`,
`al-entitlement.js`), but the save checks read only the date's own year and the next
(`allowanceYearsOf`, `christmas-leave.js`). So (a) a booking that puts year y+2 over its allowance saves
WITHOUT the warning — the banner and the Calendar's leave panel then show it; (b) an absence can name a
"day in lieu that goes" when the chain's total is unchanged. Found by the 24-hour review, 25 Nov 2026.

- **Who notices:** a manager, after the save. Not reachable before December 2028: it needs a Dispatcher
  who works two Boxing Days running and books late-December leave past the allowance both years, and
  Boxing Day 2027 is a Sunday, which earns nothing.
- **Fix, before December 2028**, with `CONFIG.MAX_YEAR`: make `allowanceYearsOf` follow the chain while
  each later Boxing Day was earned. Widening to every later year now would multiply the work of every
  absence preview.

## Pay calculator

### The pay-period grid ends on 12 Mar 2027 — extend it once the 2027/28 figures are out, before 7 March

The period grid (`CONFIG.LAST_OFFSET`, `paycalc-periods.js`, from the last `TAX_YEARS` row) stops at the
last 2026/27 payday. Extending it needs the 2027/28 row, the thresholds and the Student Loan tables,
mostly unpublished until early 2027 — adding a year now would present guessed figures as fact, which
`.claude/rules/paycalc.md` forbids. The pay award is not needed first. **Due** before the first 2027/28
payslip's shifts begin — Sunday 7 March 2027, for the payslip paid on 9 April — not at the tax year's
start: `docs/PAYCALC_REFERENCE.md` → "The tax year rollover"; `MAINTENANCE_CALENDAR.md` carries the date.

### Not a payslip replacement

The calculator estimates take-home pay from what staff enter. Real payslips can differ through arrears,
adjustments and deductions it does not capture.

### Pre-fill reads base roster + Firestore overrides only

"Fill from calendar" counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day) only; contracted weekday
hours are paid as basic pay automatically and have no box. A payslip with no special-rate hours is
marked by the "No special-rate hours on this payslip" tick (or "Fill these from your calendar" on a
payslip whose changes loaded and show none) and then counts as entered (`noSpecialHours`,
`paycalc-format.js`). The suggestion is advisory: staff check it against their payslip.

### A backup made under a member's old name does not restore under the new one

A backup is filed under the name it was made with, so after a rename it is refused and the member is
told to contact the admin (`NOT_ON_ROSTER`, `paycalc-transfer.js`). **Workaround:** OPERATIONS_REFERENCE
→ "Changing a member's roster name". **Decision:** a former-name record is not built (owner, 10 Nov
2026: renames are rare).

### A back-pay lump on an un-entered payslip is left out of "This tax year so far"

The year summary skips a paid payslip with no saved hours (listed under "Not entered yet"), lump and
all, while the result card shows the lump. **Judged correct:** counting only the lump of an unfilled
payslip would make "N of M entered" and the money disagree. The HPP lump behaves the same, pinned by
`paycalc-year-summary.test.mjs`.

## Calendar / roster

### Team View summary chips — considered and declined

A strip of per-week counts ("Working 10 · AL 2 · RDW 1") was declined: the grid is used for individual
planning, not aggregate analysis, and already reads at a glance. Do not re-add without a specific
operational use case from Gareth.

### Override cache is never cleared on member switch

`rosterOverridesCache` (`calendar-overrides.js`, keyed `"memberName|date"`) holds every member's
overrides without a size limit and is not cleared on a member switch — a switch fetches nothing, since
reads are by DATE for every member and `fetchedMonths` is keyed by month. It grows with the months
visited in a session: unbounded in principle, small in practice. Nobody notices; no fix planned.

### An override still carries a `note` field that nothing writes and nothing reads

Every override write sends `note: ''`; nothing offers or displays it (owner decision: unused, and free
text about a named colleague is a GDPR exposure). **The field stays on the write on purpose:**
`firestore.rules` requires `note is string`, so a client that stopped sending it would permission-deny
**every override write on every device**. Retiring it is a three-push, backend-first sequence whose two
rules clauses fail in OPPOSITE directions — the order is beside `buildOverrideWrite` in
`override-utils.js` and in `docs/DATA_MODEL.md` → overrides. Low priority; cheap only while somebody
remembers the ordering.

### The text-scale tiers are proven against a STATED scale, not a real Android setting

`text-scale.js` measures how much larger the phone draws text, and the Calendar's control rows tighten
from the tier it stamps. Every test states the scale through `window.__E2E.textScale` and scales the
fonts itself — a headless browser has no OS text setting — so the suites prove the RESPONSE, not the
DETECTION. **Measured:** at the default size the probe reads exactly 1.0, so nothing is stamped.
**Unconfirmed on a device:** what the 16px probe reads at Samsung "Largest" or a Pixel accessibility
size. **Who notices:** a colleague on a large setting reporting two rows — suspect the probe first.

### Under large text the month heading is HELD at its size — a compromise, not a pattern

`html[data-text-scale] .month-year { font-size: 21px }` (`index.css`): from 1.1× the heading's base drops
from 24px so it still shares a line with the week note, landing near the original 24px at "Large"
(1.15×) — this one heading resists the member's preference. **Owner decision** ("like it used to be"):
right for a two-word title beside 12px metadata. **Do not extend the pattern** — body copy, day cells,
Team View and every other page keep scaling. Another surface that seems to need it gets a second line,
not another compensating rule.

### Trains at 1.75 times text on a 320px phone, or 2 times below 412px

Measured 18 November 2026: the Trains page fits up to 1.5 times text at every width, and 1.75 times
from 360px (`trains.css` → "A phone's larger text"; the e2e "no view of the page runs off a phone's
screen with larger text"). Beyond that **a station's train list runs past its card** — 11px at 1.75
times on 320px, 9px to 49px at 2 times below 412px — and at 1.75 times on 320px the lookup's column
heads by 3px. **Fix, not built:** another layout for the list (each train on two lines), which changes
how a screen reader reads the table and wants trying on a real phone first.

### Shift DURATION in the day panel — considered and declined

An external review proposed "9 hours" under `07:00–16:00`. **Declined:** the app has no paid-hours
model — breaks are not in the data and the calculator works from hours a member ENTERS — so the only
figure available is the clock difference, which a member would reasonably read as paid. It is not
hard (`admin-shift-rules.js` computes lengths, midnight included), which is why it is written down.
**Revisit only** if a real paid-duration rule ever exists in the data.

### Duplicate Firestore override documents

Where one member and date have several override documents, the cache keeps a manual change over an
import, and otherwise the newest (`shouldReplaceOverride`, `override-utils.js`). Nothing logs them.
**Workaround:** clean up at source in the Firebase Console; manual duplicates also clear when Admin next
saves or deletes that day ("Two editors on one day", above).

### Deleting an AL doc destroys the swap evidence it carried

Leave written over a swapped-in day is the only record of the swap (`replacedType`). Cancelling that
leave removes it, and the day reverts to base REST; leave re-booked there is asked about as any rest
day is (`.claude/rules/admin.md` → "AL on a rest day is ASKED about"). **Who notices:** the manager —
the calendar now shows Rest on a day the member is contracted to work, and re-recording the shift
restores both display and evidence. **Decision:** not coded around; the shift's TIME was never kept,
so it could not be restored anyway. If a cancelled-leave-on-swapped-day case recurs without the
re-record, store more than the type.

### The Annual leave sheet card adds missing leave, counts swapped rest days, and nothing else (Phases 1 and 2b, owner, 14 Nov 2026)

Operations → Annual leave sheet adds the leave the app is missing for each person the admin confirms,
and counts leave already held on a rest day answered "swapped". Every other difference is fixed by
hand in Admin (DECISIONS.md → The annual leave uploader; OPERATIONS_REFERENCE.md → "Checking the clerks' leave sheet").
What it leaves open — the admin's own look at each person before confirming is the control in each:

- **The FIRST Save of a year cannot tell "cancelled since" from "never recorded"**: before any upload
  log for that year exists, leave cancelled after the clerks' last save reads as "not in the app". The
  per-person confirmation and the 14-day age limit stand in the way.
- **A Save the app could not read back, or whose record could not be written, is logged only by the
  next check of the same file, in the same visit.** Close the page first and it has no log: no Undo
  from the card (delete its days in Admin), and its days are unprotected until the next Save's log.
- **The Undo is for the latest Save of the year that added leave, once.** Earlier Saves are undone by
  hand; a rest day counted as swapped stays counted.
- **One spelling is one answer, in every grade block**: two people spelt alike in two blocks share one
  answer. It never files one's days under the other — the other's row stops the file, or the question
  returns with every copy.
- **It knows only what the workbook says.** Column E's undated days are reported as figures and never
  written; a column-E value with no comment has lost its dates for good (AL_WORKBOOK.md §8 defect 5).
- **The carry-over is matched by count, not by day** (earliest moved-back January days first), so a
  carry the app has not moved, or more moved days than carried, shows as a difference.
- **An old copy is compared, not saved**: past 14 days, with no save date, or a sheet for a year before
  last (every Save deletes those years' records, so its own record would go at once).
- **An update waits** while an answer is on screen or answers wait unsaved; Clear lets it in. A
  notification tap waits only for an unsaved confirmation or "Swapped — counts", or a running Save/Undo.
- **The seal catches a hand edit, not a forgery** — the digest is public code. Using a file needs the
  admin's own sign-in.

---

## Navigation / accessibility

### No `inert` behind dialogs (focus is trapped; the background is not inert)

Every dialog traps Tab (the drawer, and every lightbox through `createLightbox`) and is `role="dialog"
aria-modal="true"`, but a screen reader's browse mode can still reach the page behind it. **Who
notices:** TalkBack and VoiceOver users alike. **Deferred:** `inert` on background content (used today
only locally, in `admin-roster-upload.js`, `admin-week-editor.js` and `operations-al-sheet.js`).

### The drawer does not pull back focus the iPhone keyboard's arrows move out of it

The ‹ › arrows above the iPhone keyboard move focus between text fields with no key event, so a Tab
trap never sees them. Every `createLightbox` dialog pulls such focus back (`_guardFocus`,
`overlay-focus.js`); the drawer, its two lightboxes and the Huddle viewer have their own traps and no
guard, so the arrows can leave *Search the guides* for a field behind it. **Not built yet**;
`nav-panel.js` has room under its cap (`coordinator-ratchet.test.mjs`). Device check:
`IPHONE_RELEASE_CHECKLIST.md` → B.

### On an iPhone, reloading a guide opened at a heading goes back to that heading

The guide scripts never pull back a reader who has moved from a `#heading`, but on a RELOAD Safari
scrolls to the fragment itself, where Chromium restores the reader's place (`e2e/guides.spec.js` → "a
deep link does not pull back a reader who has moved, or a reload" passes on both engines). **Decision:**
recorded, not built — taking over `history.scrollRestoration` would fight Safari's reload on every guide
for a rare gesture (whole-app check, 10 Nov 2026).

---

## PWA / service worker

### PWA shortcuts — and the manifest `name` — require reinstall to update

Changes to `manifest.json` shortcuts, and to `name` (drawn by pre-Android-12 Chrome's splash), reach an
existing install only when it is removed and re-added (`.claude/rules/pwa.md` says why the name is
short and ASCII).

### Printing from the installed app on iOS 27 does nothing — so the app says so

In a home-screen web app on iOS 27, `window.print()` does nothing — no sheet, no error, no `beforeprint`
(WebKit bug 325259, 25 Sep 2026, places it in Apple's web-app shell; no page-side workaround). **What
the app does:** every print control goes through `print-guard.js`, which on an installed iPhone or iPad
explains and offers "Open in Safari". Every iOS home-screen launch gets it, older iOS included, because
the user agent's iOS version is frozen. **When Apple ships the fix** there is no version to raise:
retire the guard once an installed iPhone is seen to print. **Unconfirmed:** whether `window.open` from
the home-screen app lands in Safari or its in-app sheet (both can print from the share menu).

### Samsung Internet’s Dark mode repaints the app dark — the opt-out it ignores, and the per-device answer

Reported 23 Oct 2026: on a Samsung phone the Calendar's cards and cells went dark grey, text light, hues
kept and darkened. That is the browser's **forced-dark algorithm**, not a theme in the app, which has
none (`.claude/rules/css-tokens.md` → "No dark mode").

- **The app already opts out both ways** — `color-scheme: only light` on `html` (`shared.css`) and
  `<meta name="color-scheme" content="only light">` on every page (`page-contract-parity.test.mjs`).
  Chrome honours it; **Samsung Internet does not**, and Samsung says no page-side logic bypasses it. An
  install made from Samsung Internet is repainted the same way; one from Chrome is not.
- **What it costs:** the design only — every cell carries its word or emoji as well as its colour, and
  hues survive. A member may read it as a fault.
- **Workaround, per device:** turn Dark mode off in Samsung Internet (Settings → Appearance, or Labs —
  the menu moves), or use or install from Chrome.
- **Decision:** the only code answer is a real dark theme, which reverses the no-dark-mode decision on
  every page; declined (ROADMAP.md → "Dark mode (toggleable)" is where it would reopen). A darker
  palette or an inverted override would be repainted too.

### Service worker activates immediately (`skipWaiting`)

A new service worker takes over every open tab at once. In the rare mid-session race this causes, a hard
reload resolves it.

### Mixed-version cache window during a deploy — mitigated, not fully closed (accepted)

Between a deploy and a client reloading onto it, a page could pair one version's HTML/JS with another's
and throw. Mitigated: every asset comes from the one version-pinned cache (`myb-roster-v{APP_VERSION}`);
a miss that cannot be fetched falls back to the **newest** older cache for HTML and JS alike
(`matchNewestManagedCache`); and the `controllerchange` reload (`sw-register.js`) converges every client.
Roster data is always live.

**Residual (accepted):** a partially-warmed current cache can pair a fresh module with an older
fallback for that one window, and a `beforeReload`-deferred reload (an admin mid-edit) runs old JS
against a new worker until it reloads. **Decision:** closing it needs per-file version markers (the
cheap HTML marker was removed — it made every bump touch ~8 files) or per-load version coordination with
a self-heal reload (a reload-loop hazard), both in the highest-outage-risk file. Revisit only if a real
mixed-version incident is seen.

### Dual hosting: web.app is canonical, and the github.io mirror still serves about half the staff

- **`https://myb-roster.web.app`** (+ `myb-roster.firebaseapp.com`) — Firebase Hosting, **canonical**:
  the URL for any new install and the origin in notification payloads (`STAFF_SITE_URL`).
- **`https://garethdavidmiller.github.io/roster-app/`** — the GitHub Pages mirror (note the sub-path).
  **Installed users are now roughly level between the two** (owner, 27 Nov 2026; in Sep 2026 most staff
  were here — the move is gradual by design, and it is working). It serves no redirects and no HTTP
  headers, so anything leaning on either misses everybody here.

**Why both are safe:** push delivery is origin-independent, and the service worker re-bases a
notification's target onto its own `registration.scope` (`notificationclick`, `service-worker.js`), so
each install taps through to its own origin.

**On the mirror the installed app's identity is the bare origin** (`manifest.json`'s `id` `"/"` resolves
to `https://garethdavidmiller.github.io/`). Latent while nothing else installable is published there;
left on purpose — `.claude/rules/pwa.md` says why changing it would cost every install.

**Both origins must stay in the GCP API-key referrer allowlist** until github.io is retired — dropping
one silently breaks all Firebase Auth there (task #1 above).

**Retiring github.io** (optional, no deadline): confirm staff have moved, remove its allowlist entry,
turn off Pages, and delete `.github/workflows/deploy-mirror.yml` in the same change (it fails, by design,
when it cannot read the Pages setting). **Two things are silent if forgotten:** Pay Calculator figures
are stored per address, so staff must move them with 💾 Move Your Pay Data first (OPERATIONS_REFERENCE.md
→ "Which address staff are on"); and the New link page's PDFs are served from the mirror ("The new link
page — two constraints", below).

### ⚠️ The installed PWA masks live-site breakage — verify the URLs, not your phone

An installed PWA launches, and updates, from its service-worker cache even when the **live deployment is
completely broken** — a splash that never clears, a `404`, a CSP violation, a missing API-key referrer
entry. That is how the June 2026 outage went unseen (Firebase stuck on the splash, the Pages URL 404ing,
every installed phone fine).

- **Never treat "my phone works" as evidence the site is up.** Test the live URLs in a fresh private
  window — the checklist and cadence are **CLAUDE.md → "Deployment health check"** — after any change to
  `firebase.json` (CSP/headers), the Firebase SDK version, the API-key allowlist or the hosting setup.
- **Who else notices:** `live-health.yml`, on a four-hourly schedule that GitHub keeps about three times
  a day, runs `npm run test:live` on a GitHub runner — root, `admin.html` and `paycalc.html` on BOTH
  origins: served, splash down, something usable, no console errors. It demands a DIRECT connection
  (`LIVE_REQUIRE_DIRECT=1`; the relayed fallback cannot see the referrer restriction). A page still
  failing a minute later is reported on the `deploy-failure` issue. The hourly
  `production-currency.yml` is a different question — the served VERSION — and reads a stuck splash as
  current. Neither replaces the manual check after a `firebase.json`, SDK or allowlist change.
- **One red line is the policy working** (measured 12 Nov 2026): leaving a page with an open Firestore
  connection can log a refused `www.google.com/images/cleardot.gif` — Firestore's transport testing the
  network after closing (`e2e/csp.spec.js` names it). It shows on a fresh load only with *Preserve log* on.
- **A deploy-ignore pattern must never match a file the app imports at runtime.** That outage was a
  `**/*.mjs` in `firebase.json`'s hosting `ignore` dropping `purify.es.mjs`. No test guards this
  direction: when adding a runtime asset with a test-like extension, check every `ignore` glob.

---

## Huddle ingest

### Power Automate HTTP connector is Premium

The flow needs the Premium **HTTP** connector; "Send an HTTP request (Office 365)" does not work here.

### File type detection uses filename extension, not Content-Type

Power Automate sends `text/plain` for PDF and DOCX alike, so `ingestHuddle` reads the type from the
`X-Huddle-Filename` extension.

---

## Roster data

### The base-roster drift detector is BLIND on a flat pattern — measured 60% coverage

`detectShiftedRow` (`roster-alignment.js`) correlates the parsed week with the member's base pattern at
offsets −1/0/+1 and needs a ±1 alignment to beat 0 by ≥3 matches — evidence that exists only where a
week has SHAPE. On a flat line (`RD · 09:00–16:00 ×5 · RD`) a one-day slip moves two cells, never three,
so it rightly reports nothing. **Measured 2 Sep 2026** over every active member, ten weeks, both
directions: **538 of 900 one-day shifts detected, 60%**; three members on flat fixed lines were blind in
at least 18 of their 20 cases. So the people hardest to check by eye are the ones it cannot speak for.

- **What still covers them:** the PDF's own grid. On the geometry path each day is placed by coordinate
  (`functions/roster-prompt.js`) once the sheet's header has been read Sunday to Saturday
  (`readGridPage`, `functions/roster-geometry.js`), so a row cannot slip. On the PDF fallback the
  geometry witness still refuses a claim in an empty cell; its column order comes from a page's printed
  header (a page with no header, in a file no page contradicts, is read Sunday first — the order of every
  roster measured). When `geometry.status` is `unavailable` these members have no independent check, and
  the review says so (`geometryCopy`, `roster-alignment.js`).
- **Decision:** recorded, not fixed — a fix needs a second pattern-independent witness or a weaker
  threshold, and the latter would trade silence for false refusals on the rotating links. Revisit if a
  flat-line member is ever the one a misread week lands on.

### A rest day read for an empty weekday is believed on the PDF path — and a printed RD is never checked

A blank cell is an ANSWER on Sunday (uncontracted) and a QUESTION Monday to Saturday, where unworked days
are always stated explicitly (`buildSafeEntries`; the contract is `.claude/rules/roster-import.md`). On
the geometry path the server knows which cells are empty, so an RD read for an empty weekday, or an
empty read of a filled cell, goes to the review (`reviewRestReadsOfEmptyCells`,
`reviewBlankReadsOfFilledCells`, `functions/roster-prompt.js`). **What still holds:**

- **On the PDF path** (the fallback whenever the grid cannot place every member) the safety rests on the
  model obeying the prompt: an `RD` written for an empty weekday imports as a rest day, and the geometry
  witness cannot refute it. **Who notices:** the admin, on the review table every import passes through.
- **On both paths a printed duty read as `RD` in an OCCUPIED cell is not checked** — telling them apart
  means reading the text, phase 3 of `ROADMAP.md` → "Roster import".
- **Do not rebuild the cross-check on the column scan.** It was built and the fixtures refused it: the
  scan uses `blank`, `OFF` and `-` interchangeably, so a scan `blank` is no evidence of an empty cell.
  The reasoning is in `applyColumnScanCrossCheck`'s header (`functions/roster-parse-helpers.js`).

**Worth watching on a live Dispatch import.** Over the 12-document geometry corpus (1 Sep 2026,
`experiments/roster-pdf-geometry`), blank Mon–Sat cells are 1 in 678 on CEA, none on Supervisors, and
**48 in 324 (15%) on Dispatch** — four people who appear there and work most of their week elsewhere,
exactly the case the rule exists for. When a row's Monday to Saturday are all unread its Sunday is
unread too (`computeCellStates`, November 2026), so a Dispatch import sends roughly a dozen rows to the
review, each answerable in place. If that proves tiresome, whether a member blank Mon–Sat on a SECOND
sheet should be skipped wholesale is a product decision, not a bug.

### On the PDF path the Sunday scan outvotes the row read and the column scan

When the row read and column scan both see a shift on Sunday and the Sunday scan alone reads it empty,
`applySundayScanCorrections` (`functions/roster-sunday-repair.js`) treats the row as slid: a day right if
Saturday read empty, else the Sunday is disputed and the geometry witness or the review settles it.
**Measured** over synthetic weeks (November 2026): of 53,248 single wrong Sunday-scan readings, 4,096 end
with values on the wrong day; where the witness can read the grid it refuses 3,440 of those and misses
656. **Decision:** recorded, not changed — a lazily copied column scan agrees with a drifted row, and on
that row the Sunday scan is the only read that saw the empty cell. The geometry path asks for no scan.

### The sheet's own week is checked only where its heading can be read

`checkSheetWeek` (`functions/roster-week-heading.js`) reads the printed `Week Ending: DD/MM/YYYY`
heading, in the layout measured on a real CEA sheet (owner, 10 November 2026), and refuses a sheet for
another week before anything is written. **Unchecked:** the CES and Dispatcher sheets (not yet
measured), a scanned sheet (no text layer), and a grid read that never settles within its budget. Then
the upload proceeds as before the check, the Functions log says "the sheet's own week was not checked",
and only the admin catches a whole week out.

### Cloud Function staff list is generated from `roster-data.js` — regenerate it in the same commit

`parseRosterPDF` matches names against `functions/roster-members.json`, generated from `teamMembers` by
`npm run generate:roster-members` and carrying no "do not edit" marker; never hand-edit it.
`sw-asset-check.test.mjs` fails on drift, so a starter or leaver means editing `roster-member-data.js`
and regenerating in the same commit (the `/new-starter` and `/leaver` skills include it).

---

## Links design workspace — accepted constraints

The workspace's rules are `.claude/rules/links-design.md`. What it deliberately does not do, or cannot
know:

- **Duplicate names are refused from the list you LOADED, not from the collection.**
  `links-design-naming.js` refuses a name already in this page's list, but two designers holding the
  same list can each create "Option B" — random Firestore ids, both writes succeed, neither is told. The
  promise is "you cannot knowingly create a duplicate", not "duplicates cannot exist", though the
  message reads like the stronger one. **Decision:** not closed — server-owned uniqueness is real
  machinery for a handful of designers who rarely overlap. Revisit if that changes; the shape is
  `links-target-sets-store.js`'s transaction.
- **The rotation's length and cover weeks rest on evidence class C** — the owner's verbal account
  (`docs/links-26/RULES.md`, which advises getting staffing levels in writing before a design is put
  forward). Fine to build against; not something to present to an assessing manager as a requirement.
- **The run cap cannot always reach its target, and says so.** "Most shifts in a row" defaults to
  `DEFAULT_MAX_RUN`; with the full objective set on, the status line states the achieved figure and the
  shortfall. The trade is **weekends off**: on the 24-line default every weight that reached the target
  cost 3–4 full weekends. **An owner decision still to be made** — a longer run inside the company limit
  against weekends staff feel — so it is recorded, not tuned (`docs/LINKS_REFERENCE.md` → Line order, the
  run-cap switch has the measurements).
- **Designs longer than the rotation are left exactly as they are** (`.claude/rules/links-design.md` →
  Line numbering). The admin's *Keep only the shortlist* bins every design saved before 2 Nov 2026 in
  one press; until then a designer can work on a link nobody is building.
- **The fatigue-factor panel is an AID, not a fatigue risk assessment** — the risk is a design with few
  findings being read as approved. It reports which ORR p3 factors are *present*; the ORR's escalation
  (justify, minimise, assess the residual) is a human process it does not perform.
  - **FF19 is the owner's reading**, rendered "(definition to confirm)": "a rest day resets it", more
    lenient than ORR 7.71. On the strict wording all 9 proposal sheets of 28 Sep 2026 have FF19; the
    owner's reading left 4 clear. The other rows were checked against ORR's *Managing rail staff
    fatigue* (Aug 2024) on 28 Sep 2026 (`links-fatigue.js`).
  - **A cover week's hours are an assumption, stated**: the 55-hour row counts each worked cover day,
    Sunday included, as a quarter of the contracted week (8h 45m) and shows the floor beside it
    (17 Nov 2026). A count of long duties cannot see a cover week, so it is a floor, and says so.
  - **Coverage is not completeness.** The night-shift family is asserted not-applicable because CEAs
    work no nights, and flips live if any duty reaches 00:00–05:00; nothing models workload, commute or
    circumstance.
  - **The baseline is the MAIN cycle at its own length** (`weeklyRoster`). Splicing two unrelated
    rotations end to end reports a longest run that belongs to the join, so a design's figures mean
    something only once its lines are one rotation.
- **The generator's objectives genuinely conflict** — line ORDER is one scarce resource, and `gentle`
  and `variety` are opposites (`docs/LINKS_REFERENCE.md` → Line order). The switches are the
  answer: the designer makes the trade.
- **Interleaving the waves inside the generator is a WON'T-DO, measured** (`.claude/rules/links-design.md`
  → the generator): a 6h25 turnaround and two long weekends lost for no gain. A test fails if it returns.
- **The hard-limit check is a WORST CASE on a design, and it enforces nothing.** The consecutive-days
  limit (`MAX_CONSECUTIVE_WORKED_DAYS`, `links-limits.js`) is **Chiltern's roster limit**, from company
  policy; its origin is the standard adopted after the **Hidden report** into the 1988 Clapham Junction
  crash, withdrawn in 2007 — so Hidden is cited as an origin, never a current requirement, and it is not
  legislation. It passes or fails and renders red on a breach, but:
  - **It measures the LINK, not a person** — overtime, RDW, cover and swaps are invisible here.
  - **It is a ceiling, not a prediction** — a spare week's four duties are placed by the clerk week by
    week, so the figure is what the link *permits*; never quote it as how many days in a row people work.
  - **It rests on a spare week being four duties, Monday to Saturday** (owner, Aug 2026), with its
    Sunday counted as worked in the worst case (owner, 31 Oct 2026). If the cover model changes,
    `SPARE_WORKED_DAYS` and `spareDrawsOnFour` (`links-design.js`) move with it.
- **The generator and the grid lose their column headers on a PHONE.** Below 768px each table sits in an
  `overflow-x: auto` wrapper, which per spec makes it a vertical scroll container too, so the sticky
  header sticks to a box that never scrolls. **Do not "fix" it with `overflow-y: visible`** — the spec
  overrides exactly that. Measured at 390×844: the grid is about 43% off-screen with no header for most
  of the scroll. **Accepted:** the orientation panel says it is best on a desktop or tablet, ≥768px gets
  the working layout (`links.css` says why 768), and the real fix — a `max-height` nested scrollbox
  around the main editing path — is a UX decision (`ROADMAP.md` → Links generator). An e2e pins both
  widths.
- **From 768px to about 830px, at Android's largest text, the grid cuts off its last totals column.**
  From 768px the wrapper stops scrolling so the day header can stick (`links.css`, the 768px block).
  Below 1024px the totals' names and the days note may wrap, so it fits at normal text and 1.3×
  (`e2e/links.spec.js`); at 1.6× (Font size × Display size, invisible to
  width queries) the table needs 754px and the card clips the last column with no scroll.
  **Accepted: the owner kept the sticky day header** (10 November 2026).
- **The coverage heat map counts pattern positions, not a named headcount** — every position, designed
  or not, on a scale relative to the week's own peak.
- **EVERY line rotates and must be filled** — an all-rest line is unfinished, not a vacancy
  (`.claude/rules/links-design.md` → Line numbering): the link must survive staff changes. "Start with a
  blank grid" (`#linksEmptyNew`) and the importer (`links-import.js`) are flagged until every line is
  designed.
- **The rotation LENGTH is hardcoded by design** — `ROTATING_LINES`, the agreed concept, not derived
  from roster data (invariant 1). **Do not write the number down here.**
- **Save concurrency is warn-on-conflict, not merge.** A conflicting save names who saved last and offers
  **"Save mine as new"**; the whole document is still replaced (`links-concurrency.js`). Two devices
  under the SAME display name with an unknown baseline do not conflict-prompt (`conflictOf`'s header).
- **The consecutive-day hard limit has no document citation yet, and the panel SAYS so.** The evidence
  gate needs class A or B before anything renders as "must be met"; this is class **C** (owner, Aug
  2026), so the heading reads "Configured Chiltern limits — policy source outstanding".
  `POLICY_SOURCE_CONFIRMED` (`links-limits.js`) is its single home, tested in BOTH directions, so the day
  the citation arrives is a test failure, not a forgotten edit. **Missing:** the policy's title, clause,
  staff group and effective/review date. **To close:** put it in `CONFIRMED_BASIS`, flip the flag, run
  `npm test`. Promoting the other limits (turn length, rest between turns, weekly ceiling) needs the
  confirmed figures — never from recall.
- **Delete is a SOFT delete and the bin is PERMANENT** (owner, 19 Sep 2026): nothing expires a binned
  design and nothing will (`.claude/rules/links-design.md` → Deletion; `links-deletion.js`'s header).
  `doc-parity.test.mjs` fails if a countdown constant comes back.
- **The generator's provenance is DEVICE-LOCAL** (external review, Sep 2026): which target table built a
  design lives in `localStorage` (`myb_links_gen_<designId>`, `links-generator-targets.js`), so a
  colleague sees the note absent and cannot answer "what staffing was this built from?". Moving it means
  adding a field to `linkDesigns`' `hasOnly` list — a **backend-first** change (CLAUDE.md → Workflows)
  and a decision about what a shared design asserts. Until then it is one designer's working memory.

## Overtime Availability — accepted gaps

Design: `OVERTIME_AVAILABILITY.md`. Operating: OPERATIONS_REFERENCE.md. What the feature deliberately
does NOT do yet.

> **Paused** (`CONFIG.OVERTIME_ENABLED` is `false`): only the retention purge is deployed. Read this as
> what the feature does when it returns (`OVERTIME_AVAILABILITY.md` → Paused).

- **The SUNDAY-RELEASE REQUEST is only ever a request** (`overtime-sunday-release.js`, stored as
  `releaseRequested: true` — `REQUEST_DAY_FIELDS`): it writes no override, changes no roster, uses no
  leave and is never worded as granted (`OVERTIME_AVAILABILITY.md` invariant 14). The server checks the
  CALENDAR, not the roster, and refuses the field on any day but a Sunday.
- **"Away for a rostered Sunday duty" is therefore a REQUEST, not an absence.** Sundays are uncontracted,
  so leave and absence cannot be written on one (`SUNDAY_FORBIDDEN_TYPES`). A non-entitlement absence
  type was proposed; **the owner's answer was the request**. Do NOT loosen the AL rule. **Gap:** the
  roster team's DECISION is not recorded, so the Calendar shows the Sunday duty until that week's PDF is
  imported or the shift is changed in Admin.
- **Expiry purge: dry-run until 1 Dec 2026, then automatic.** Windows past `retentionUntil` are filtered
  out of both read endpoints (rules are not filters — a `resource.data` condition would fail a whole
  query). `purgeExpiredOvertimeWindows` logs what it would delete and arms itself on 1 Dec 2026
  (`purgeArmedAt`; MAINTENANCE_CALENDAR.md, VAL-OT-001).
- **Nothing tells the REVIEWER who is outstanding.** Members get two targeted notices; the reviewer has
  only *Awaiting a form* and **No response**, which is why those must never merge into "not available"
  (OPERATIONS_REFERENCE.md → "Nobody is asked silently any more").
- **The reviewer's workspace is a SNAPSHOT.** It states its age, offers Refresh and re-reads on becoming
  visible, but does not listen — a listener costs a read per revision per open workspace, more than a
  restricted beta justifies (`OVERTIME_AVAILABILITY.md` → "Evidence to gather during the beta").
- **Restricted audience — TWO lists.** `currentAudience()` selects members with the server-owned
  **admin** entitlement **or** named in `overtimeBeta`. Widening is `CONFIG.OVERTIME_BETA` plus
  `npm run generate:roster-members`; an un-regenerated list gives somebody a page with no form.
- **An open window's population can GROW only before its first deadline** (`OVERTIME_AVAILABILITY.md` →
  "The audience is release policy, not an operational choice"); a later invitee joins from the next week.
- **Name-keyed documents.** A rename would orphan a member's participant and submission documents; the
  `uid` stamped on first submission is the recovery route, and nothing reads it today.

## Test coverage gaps

The suite is broad (`docs/FILE_INDEX.md` routes every suite; `doc-parity.test.mjs` keeps that complete),
and every Cloud Function handler and `firebase-client.js` run in the unit lane against fakes. **Before
adding behaviour to `firebase-client.js`, add the test with it.** A gap found and not closed belongs
here; the pull request template asks for exactly that.

**The coordinators have no unit tests — a DECISION, not a gap.** `calendar-app.js` and `admin-app.js` are
what remains once the pure logic is extracted, so a unit harness would mock the whole page. Their
seams are wiring-tested in e2e, deliberately: `e2e/calendar-day-detail.spec.js` pins
`personalActionsAllowed` at its call site, `e2e/admin-leave-booking.spec.js` pins `_syncMemberFor`, and
`page-contract-parity.test.mjs` pins every page calling `initErrorReporter`, `recordUsage` and
`recordPageLatency` inside its auth barrier (a call before an identity is rejected in silence, and the
Error Log then looks healthy *because* it is broken). That IS the wiring test CLAUDE.md asks for.

## Error Log noise filters

`shouldReport` (`client-errors.js`) drops classes that are not this app's faults before the Firestore
write: the opaque `Script error.`, extension URL schemes, `ResizeObserver loop`, an abandoned view
transition, a service-worker background-update failure with a network phrase, WebKit's IndexedDB
teardown messages from Firebase Auth's script (`firebase-auth.js`, named in the URL or stack), and a
cross-origin script not on the app's CDN origins. Each rule's reasoning is beside it.

- **Who notices:** nobody — a real fault worded exactly like one of these is not logged; each is matched
  as narrowly as possible.
- **Rule: no filter without a test on BOTH sides** (`error-reporter.test.mjs`): too narrow leaves visible
  noise, too broad silently swallows real errors and the log looks healthy because it is broken.

## Error handling — the silent catches

**A catch that does nothing is right only where its failure changes nothing a person needs to know.**
The intended kinds: best-effort extras (telemetry, warm-ups, an early token refresh, a repaint — a failed
log write cannot itself be logged); browser storage refused; an optional platform call (a pointer
release, a withdrawn install prompt, a refused focus or history call, a missing API); a failure reported
elsewhere by the function called; a barrier waiting on an earlier step whose outcome is read next; an
answer that may not be there (a non-JSON error body, nothing cached → `null`); clean-up of something
already gone; and the service worker's cache and update checks.

- **How to tell an intended one:** its reason is beside it, e.g. `catch { /* storage unavailable */ }`.
  **Give a new one its reason.** If no kind fits, log it (`console.warn('[tag] message:', e)`), and where
  a member lost something — a save, a document — the screen says so.
- **`console.warn` reaches DevTools, not the Error Log**, which records only what escapes (an uncaught
  error or unhandled rejection) and the slow-save notices (`error-reporter.js`).

## Time-boxed maintenance (deadlines, not bugs)

Every dated obligation lives in **`MAINTENANCE_CALENDAR.md`**, each with a warning point earlier than its
deadline. This heading is a signpost for readers arriving from an old link.

---

## Whole-app audit — deferred findings (v17.54)

An adversarial audit found no high or critical bugs; this was deliberately not fixed:

- **A payday or cut-off crossing a year boundary is filed under the wrong year (LATENT).**
  `getPaydaysAndCutoffs(year)` files an entry under the unshifted payday's year, but a paired cut-off (or
  a bank-holiday-shifted payday) can fall in the previous December, where `isPayday`/`isCutoffDate` miss
  it. **Unreachable under `MAX_YEAR = 2030`** (verified zero misses 2026–2030; first bites ~2034). **Fix
  when extending `MAX_YEAR`** (`MAINTENANCE_CALENDAR.md`): key each entry by its own date's year, or have
  the year lookup also pull `year+1`'s first entry when its cut-off lands in `year`.

---

## The member claim — two optional console steps remain

A token's `name` is believed only on a PASSWORD sign-in at the email that name derives to, with the
server-stamped `member` claim equal to it (`isMember`, `firestore.rules`; `memberNameFromClaims`,
`functions/member-identity.js`; AUTH_AND_SESSIONS.md invariant 19). An account registered from the
client carries nothing the rules or endpoints believe, and **Set up accounts takes back** an existing
account at a roster email with no custom claim (it stamps `resetAt`, resets the password and revokes
sessions, and stamps claims only after; a failed take-back stamps none).

**What remains is console hygiene, not a control** — neither grants anything, and neither can be checked
from the repository:

- **Client sign-up** can be switched off.
- **Anonymous sign-in** is recorded as still enabled. Nothing signs in anonymously and the rules refuse
  it, so switching it off (Console → Authentication → Sign-in method) only removes it at source; check
  in a private window afterwards that the Calendar still loads.

Running Set up accounts promptly for a new starter is still good practice, but no longer the control.

## The new link page — two constraints

- **Its PDFs are served by the GitHub Pages mirror** (`PACK_BASE`, `newlink-config.js`), because Firebase
  Hosting serves nothing under `docs/`. Retiring the mirror breaks every pack link; move the files into
  a served folder first.
- **Its audience is written twice.** `newlink-config.js` → `audienceNames()` says who the page is for, and
  `auth-policy.js` → `newlinkAudience` is the gate, because `newlink-boundary.test.mjs` keeps the page's
  modules out of every roster page. `newlink-config.test.mjs` holds them equal, so setting `AUDIENCE` to
  the 26 means changing the role with it (OPERATIONS_REFERENCE.md → "The new link page").
