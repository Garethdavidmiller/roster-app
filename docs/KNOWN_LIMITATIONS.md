# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: November 2026 — v25.90 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

Every heading here should read as **still true today**. When an item closes, move it to
`ROADMAP_HISTORY.md` and keep any durable lesson in the module header or contract that owns it —
`doc-parity.test.mjs` fails on a heading that reads as closed. How each item came to be is in git
and in `ROADMAP_HISTORY.md`, not here.

---

## Left open by the full check of 3 November 2026 — each an owner decision

The bug, regression and technical-debt check of 3 Nov 2026 fixed what was plainly broken (that half
is in `ROADMAP_HISTORY.md`). These it left, each for a decision rather than a default:

- **Weight.** `.git` was about 1.4 GB on 3 Nov 2026, and each committed copy of the Links 26 pack zip
  had added ~15 MB to it, sixteen times. The zip is built on demand now (owner, 3 Nov 2026: it is
  untracked, and `docs/links-26/tooling/pack.py` says to run the script and send the file), but the
  copies already committed stay in history — rewriting it was ruled out. `docs/links-24`, with its
  own 13 MB zip, was removed on 7 Nov 2026 (owner: no longer of use); it too stays in history, and
  `git checkout 924b9dbc -- docs/links-24` restores it. The files still read moved out first: the two
  proposal grids the Links compare tests use to `test-fixtures/links-designs/`, what the Links 26
  tooling reads to `docs/links-26/tooling/reference-24/`, and `default-baseline.mjs` to
  `docs/links-26/tooling/`.
- **Size.** Several modules sit exactly at their cap in `coordinator-ratchet.test.mjs`, and the
  largest stylesheets are capped the same way by `stylesheet-ratchet.test.mjs`. A file at its cap
  takes the next feature only by extracting something first; the ratchet's header says what a good
  response looks like, and raising a cap in passing is not one.
- **Two twins kept apart on purpose.** `withTimeout` (`login-overlay.js`, `password-force.js`):
  login's copy ignores the error and the other's callers read its `myb/timeout` code, and sharing
  one would pull the Firebase module graph into the sign-in overlay's unit tests or need a new
  module, for six lines. And `fip-guide.js` carries the chip-bar blocks of `guide-chips.js` — jump,
  scrollspy, sticky offsets (watching the bar's size as well as the header's) and deep-link landing —
  woven into its country finder, where a jump also opens the country's `<details>`; the other four
  guides share the one file. Three rules are in the shared file only: the two-column rule (the FIP
  guide is one column), the hold that keeps a tapped or linked chip lit when its section cannot reach
  the top (taps v25.80, links v25.81), and a banner section starting at its banner (the FIP guide has
  no banners). Its last sections are long enough that nothing bottoms it out: a tap, measured at 375px
  and 1280px, and every visible id opened fresh as a link, at 320, 375, 768 and 1280px, lights its own
  section's chip. So none of the three has anything to do there yet.
- **Typed colours.** The coloured `rgb()`/`rgba()` literals left in the app sheets — nearly all one
  navy shadow tint — are a ratchet that may only go down (`RGB_BASELINE` in
  `css-hex-parity.test.mjs`). The guide sheets keep their own palette guard.
- **Overtime stays paused** (owner, 3 Nov 2026). Its page, Cloud Functions and tests are kept and keep
  running in CI, so it can be switched back on; removing it was offered and declined.
  `OVERTIME_AVAILABILITY.md` → Paused says what is switched off.

## The Pages mirror costs every cold load 21% more bytes (measured 5 Sep 2026)

`garethdavidmiller.github.io/roster-app/` is where most staff still open the app, and it serves the
app's JS/CSS with **gzip** where Firebase Hosting serves **brotli**. Measured across the Calendar's
52 critical-path files:

| Origin | Transferred |
|---|---|
| `myb-roster.web.app` | **339 KB** |
| the Pages mirror | **409 KB** |

**Not fixable in this repo** — GitHub Pages chooses its own encoding, and there is no header we can
set there (the same reason the CSP is mirrored into a `<meta>`). It is recorded because it prices
the canonical-URL changeover: the staff on the mirror pay that penalty on every cold load, and again
after every release. The decision it prices is `ROADMAP.md` → Address migration campaign.

## The deploy gate can flake, and a failed deploy does not retry itself

`e2e.yml`'s `unit` job and `deploy-hosting.yml`'s `check` job run the identical `npm run check`, and a
deploy has failed it once while the same commit's pull request passed (Aug 2026: a single unit test,
not reproduced locally in nine runs, and never named — the job log is too large to fetch through the
API and its tail held only passes). **If it recurs, pull the log promptly** — that is the one chance
to name the test. Staff stay on the previous release meanwhile.

- **The `npm run check` half of the gate stays single-shot, deliberately.** An automatic retry would
  hide a flake, and it would also hand a genuinely intermittent product bug a second chance to reach
  staff. The Playwright half retries once in CI (`playwright.config.mjs`), which reports a
  pass-on-retry as `flaky`. The failure notice says to run the workflow again on `main` (Actions → Run
  workflow) when the failure is spurious.
- **A failed deploy is announced, not repaired.** Every deploy workflow opens or comments on a
  `deploy-failure` issue through `.github/actions/report-deploy-failure`, whose header says why an
  issue, why repeated failures comment rather than open another, and why it never fails the job. The
  reporter is a separate job that needs the deploy job and every job before it (Hosting's gate jobs,
  the mirror's plan job), with a
  job-level `if: failure() || contains(needs.*.result, 'cancelled')`, so it fires whatever killed the
  deploy, setup included — and
  when the deploy runs out of time, which ends a job cancelled rather than failed (until 10 Nov 2026 a
  timeout told nobody); `workflow-hygiene.test.mjs` holds that shape, because the
  triggering condition is an outage and cannot be reproduced on demand. **The irreducible tail:** the
  reporter still needs `checkout` and the action itself, so an outage broad enough to take those down
  takes the reporter with it. Nothing inside a workflow can report that.
- **A failed deploy does not fix itself.** `paths-ignore` skips the deploy for a commit whose files are
  all documentation, so production can stay stale until an unrelated served change lands. Run the
  workflow on `main` (Actions → Run workflow) instead of waiting; a re-run of an old run stops itself
  once a newer run exists.

### The `webkit` job is intermittently red, and it is not a gate

`webkit` runs the smoke suite under Safari's engine in branch CI only. It is deliberately **not** in
`deploy-hosting.yml` — `e2e.yml`'s own header says why: a second engine in the deploy gate lets a
WebKit-only flake keep staff on a stale version (DECISIONS.md → "WebKit stays OUT of the deploy
gate"). Merging with `webkit` red and the rest green is the designed behaviour, not a shortcut.

Its measured flake (Aug 2026: one test failing 1 run in 6 locally, and no overlap between the
failing sets of two CI runs on one commit) is covered by one retry in CI (`playwright.webkit.mjs`).
An engine difference is deterministic and fails both attempts, so **a red `webkit` means something**.
Compare the failing test NAMES between runs: different names ⇒ flake; the same test failing again ⇒
investigate it, because the engine difference is what this job exists to catch.

## Two editors on one day: warned whenever the server can be asked

Every manual record has one fixed id per member and date (`manualOverrideId` in `override-id.js`), so
two editors saving one day leave one record, and a read served from the offline cache is refused as
incomplete (`admin-override-store.js`) rather than shown as "no saved changes".

**Since v25.90 the second editor is told.** Every Admin save of a day — the week grid's, and a leave
or absence range's — reads each day it writes in the same transaction as the write (`commitChecked`
in `admin-override-store.js`) and refuses the whole save, writing nothing, unless the day still holds
what the page showed: the record its row was drawn from, unchanged, and nothing at the day's fixed id
unless that record is the one shown. The refusal names the days — "Someone else has changed Tue 16
Jun since the page loaded, so nothing was saved. Reload the page to see the latest, then try again."
A delete has been checked the same way since v25.89, comparing every field and the record's
revision (`sameOverrideRecord`, `override-compare.js`); before that the check was a separate re-read
before a separate batch, and an edit landing between the two was deleted anyway (external review,
Nov 2026). A commit whose answer is lost is re-run by Firestore and recognised as the save's own
records, never called a colleague's.

**What remains, deliberately — offline, the later save still wins.** A transaction needs the server.
A save made while the device says it is offline, or whose check could not reach the server at all
(Firestore has tried five times over about eight seconds by then), is held on the device as a batch
and sent unchecked when the signal returns — exactly as every save was before v25.90. Offline-first
is the older promise, and a device that cannot reach the server cannot ask it anything. A save that
REMOVES a day is never held that way: with no server it is refused, writing nothing, as it has been
since v25.89. Every check first waits for this device's own saves still in its queue (v25.95,
`whenOwnWritesSent`), because the server does not hold them yet: when they have not gone in eight
seconds the save is treated as offline — held behind them, or, for a removal, refused.

**Also deliberate.** A colleague who made exactly the same change is still a colleague — their name
is on the record — so the save is refused rather than counted as done. A range booking long enough
to need more than one commit (only a long absence: a commit holds about 450 writes) checks each part
as it goes; a later part refused after earlier ones landed stops there, says some days are saved,
and refreshes the saved list. And what a range booking compares with is what the page had loaded
when the booking started, so a read landing between the card's preview and its save is the one
window in which it compares with newer data than the reader saw. Revisit if a lost edit is ever
reported from either.

**The weekly roster import is covered differently, since v25.92** (`saveRosterWrites`,
`roster-import-save.js`). A manual record always outranks an import, so a record the import ADDS can
never hide a colleague's day; what can lose their edit is a record the import DELETES ("Use new
roster" over a manual change, a stale import cleared). So each part of the import's Save that
deletes is one transaction that re-reads the records it deletes and refuses — writing nothing,
naming the days — unless each is still what the review loaded, or already gone. Operations then
re-reads the week and redraws the review, so the changed days show as they are now, without a second
read of the PDF; the admin's choices on those days have to be made again, and every other row keeps
its answer, Skip all included (v25.94 — before that, every row went back to its default and a second
Save wrote rows the admin had unticked). A deleting part that is slow says to keep the page open, never
that it is held on the device (v25.94). A part that only adds is a
plain batch, held offline as before; a part that deletes needs the server, and one that fails
without reaching it closes the review as a partial save does, because whether it landed is unknown.
It first waits for this device's own unsent saves (v25.95); one that gives up has sent nothing, so
the review stays open.
**What it does not see:** a second import of the same week running at the same time — import
records take random ids, which a transaction cannot look up without a query. Only the admin imports,
so that is two tabs of one person.

**Duplicates already in Firestore from before the fixed ids** are cleared only when that day is next
saved or deleted from Admin — the week editor, a leave/absence range, or either Saved Changes delete.
Each path clears the MANUAL copies Admin has loaded for that member and day; an import is never
treated as a duplicate. On the capped All-staff list a very old day may not be loaded, so selecting
the member first is the complete route. None has been counted; nothing in the app reports them (see
also "Duplicate Firestore override documents", below).

## Admin saves are slow on iPhones — cause still being measured

Reported 5 Oct 2026, then said to be on every iPhone: each Admin week-grid save sat on "Saving…" past
the 8-second notice with full signal, and the change then arrived. What is known:
- The time is spent waiting for Firestore's server to confirm the commit. Nothing the app does
  before the write is waiting: the gate, the session wait and the override load are all bounded.
- The service worker is not involved. It handles only GET requests — same-origin, plus the Firebase
  SDK files from gstatic.
- The notice names the signal only when the browser reports being offline.

**Long-polling on iPhones was prepared and NOT shipped** (5 Oct 2026). App Speed's own data for
October contradicted the premise: on opening the Calendar, the "Not reported" connection class
(mostly iPhones) was no slower than 4G-like Android at the sign-in step, and faster over the whole
load. A transport change made for every iPhone, on a hypothesis the data argued against, was
withdrawn.

**What will settle it:** every "Slow save (diagnostic)" entry in the Error Log carries the save's
time, how much of that time the app spent **in the background**, and a **sign-in token** time
measured while the save was slow. Read them in that order:
- **the background time first** (v25.87). iOS freezes an installed app it has put in the background,
  and the clock runs on through the freeze, so a save made just before the phone was locked or the
  app was left reads as slow when nothing was wrong. Take the background time away from the total:
  what is left is how long the save waited with the app on screen. If little is left, the wait was
  the phone's, and no transport change would shorten it. "On screen throughout" means all of it is
  left;
- if the token took seconds, auth is the bottleneck;
- if the token arrived in milliseconds and the on-screen wait was still long, it is the connection to
  Firestore — with one caveat: timing starts at the 8-second mark, so a token refresh that held the
  save and then finished before it reads as milliseconds too. Milliseconds rules out auth as what is
  STILL holding the save, not as what held it earlier.

Entries from before v25.87 carry no background figure, so they cannot tell a frozen app from a slow
connection. One from an installed iPhone app on 11 Nov 2026 (81.8s, token 0.0s) could not, and is
why the figure was added.

These entries are listed in the Error Log but not counted as unresolved errors (`DIAGNOSTIC_PREFIX`
in `client-errors.js`). Read the entries from iPhones before choosing a fix.

## Anybody can hold the staff PIN shut — an owner decision, not yet taken

`unlockCalendarViewer` throttles failed PINs twice — per source, and under an all-sources ceiling
with a fixed key (`DEFAULT_THROTTLE` and `GLOBAL_THROTTLE` in `functions/calendar-viewer-auth.js`,
which carries the arithmetic). The ceiling is what stops a distributed guess at a four-digit PIN, and
it is also the weakness: a stranger sending wrong PINs from enough addresses keeps it reached, and
while it is reached **every member of staff is refused the PIN**, correct or not. Nothing leaks; the
Calendar is simply closed to anyone not signed in by name, and the block clears itself. Raising or
removing the ceiling makes guessing cheaper, so it is a trade-off for the owner rather than a fix.
The two cheap mitigations, if it is ever seen in the logs: rotate the PIN to a longer one (the limit
then protects far more), or let a correct PIN through the ceiling while still counting it.

## The iPhone status bar is solid — and was changed without a device to test on

Every page sets `apple-mobile-web-app-status-bar-style` to `black` (`page-contract-parity.test.mjs`
holds every page to it), so iOS draws a solid bar and the page starts below it. It answered a report
from the installed app on the iPhone 18 Pro: under `black-translucent` the navy page ran up under the
status bar, which recent iOS blurs, and the header's logo and title drew blurred. **Two things are
unconfirmed**, because no iOS 27 device is available here: whether an EXISTING home-screen install
picks the change up without being removed and re-added, and how the solid bar looks against the navy
(it is expected to be black, a shade off the header). If the blur persists on a fresh install, the
fallback is to keep `black-translucent` and push the header down instead — a guess at the band's
depth.

## iPhones keep two separate copies of what the app stores, and Safari clears one of them

Two iOS behaviours, reported rather than documented by Apple (WebKit bug 181849; WebKit's own
tracking-prevention policy), found by the iPhone audit of 7 Nov 2026:

- **The Home Screen app does not share Safari's storage.** Installed from Safari, it starts with no
  sign-in, no Pay Calculator figures, no notice flags and an empty App Notices list. Since iOS 26
  every site added to the Home Screen opens this way by default. Android shares storage between the
  browser and the installed app, so none of this applies there.
- **A Safari tab loses everything after seven days of Safari use without a visit** — localStorage,
  IndexedDB, the service worker and its caches together. The Home Screen app keeps its own count,
  which moves only on the days it is opened.

What it costs, worst first: **Pay Calculator figures**, the one thing here that cannot be recreated
(they live only in localStorage, by design); the sign-in; the Links workspace's staffing-table edits;
the notice flags (so a notice can come round again); and the Usage card's counts, which see the tab
and the installed app as two devices (`usage-reporter.js` keys its flags in localStorage).

What the app does about it (since 7 Nov 2026): the install wording on the Calendar and in Settings
tells an iPhone member to copy their figures first with 💾 Move Your Pay Data and that they will sign
in again (the Staff Guide, which has no printed line to spare, sends them to the Calendar to add it);
the Pay page says the figures are kept in this browser; the transfer card explains the iPhone split;
an emptied calculator points at Restore; and on an iPhone the backup goes through the share sheet, so
it can be saved to Files from a tab or the installed app. **What it cannot do** is
move the figures by itself (the two stores never meet), or protect a member who uses only a Safari tab
and stays away for a week — telling them is the lever. Whether Safari grants `navigator.storage.persist()`
(called by `requestPersistentStorage` in `ls.js`), and whether a grant would exempt a tab from the
seven-day rule, is unknown; `IPHONE_RELEASE_CHECKLIST.md` has the device check.

## Development-tool advisories that only a downgrade would clear

The ROOT tree is development tooling only — the Firebase CLI, the rules-test harness, Playwright,
ESLint. Nothing in it is served to staff. **Do not trust a count written down here; run
`npm audit`.** A transitive dev tree moves on its own, so a number in prose is stale the day after it
is written. Its shape on 13 Nov 2026 was moderate findings only, none high or critical:

- **Inside `firebase-tools`** (pubsub and opentelemetry, archiver, gaxios, glob, uuid and their
  neighbours). For the CLI's chain npm offers only `npm audit fix --force`, which DOWNGRADES the CLI
  a major version — the wrong direction, and declined. They clear when the CLI updates its own
  dependencies; re-run `npm audit` after each CLI bump.
- **Inside ESLint's own packages**, where npm's offer is likewise a major-version downgrade of
  ESLint.
- **`gaxios` is the oldest of them (F-DEP-1).** `firebase-tools` still declares `gaxios@^6.7.0`,
  inside the vulnerable range, and the fix is in `7.x`. **Do not force it with `overrides`:** gaxios
  6→7 is a major API change and an intermediate Google dependency expects 6.x, so forcing 7.x risks
  the deploy and emulator toolchain, which gates every rules and hosting deploy. Close it once
  `firebase-tools` (or its Google dependencies) widen the range to `7.x`: bump the CLI then, and
  confirm `npm run test:rules` and a hosting-emulator run still pass.

**One `overrides` entry is deliberate:** `package.json` raises `@grpc/grpc-js` under
`@firebase/firestore` to `^1.14.5`, though Firestore's own range is `~1.9.0`. It is accepted because
the only code that uses it is the rules-emulator suite, which passes on it. **If `npm run test:rules`
ever fails to CONNECT after a dependency change, remove that override first.** Drop it once
Firestore's own range moves past 1.9.

Each of the update bot's major versions is a decision of its own; `.github/dependabot.yml` says which
dependencies it leaves alone, and why.

## The test matrix and the phones staff carry

Both WebKit lanes run at the iPhone Pro geometry staff carry (`IPHONE_PRO_VIEWPORT` in
`playwright.webkit.mjs`, shared by `playwright.visual-webkit.mjs` and by the visual tests that grow
the viewport for a tall surface), under the iPhone 13 descriptor. Three things are left out on purpose:

- **The 17 Pro descriptor is not used.** A descriptor is a viewport, a density and a user-agent
  string; swapping would change only the user agent's iOS number, which the app never reads
  (`playwright.webkit.mjs` says why).
- **The iPhone's Links specs draw at 2x, not the phone's 3x** (12 Nov 2026). Most of them open a
  desktop-size window, which WebKit drew at 6.5–11 frames a second at 3x, and every click waits on
  frames; nothing in the Links code or specs reads the density, so 2x changes what is drawn, not what
  is tested (`LINKS_IPHONE_DPR` in `playwright.webkit.mjs`). Every other iPhone spec stays at 3x.
- **Landscape (874×402, 956×440) is NOT in the matrix.** Playwright's Linux WebKit reports every
  safe-area inset as zero, so a landscape baseline would prove nothing about the Dynamic Island
  insets, and the smoke suite's layout assertions are written for portrait. A real iPhone in
  landscape is a device check, not a CI one.

### The Playwright upgrade — the baselines come from CI's render, not the container's

- **A container's render differs from CI's, even on the same browser build.** At the upgrade to
  Playwright 1.63 the baselines were first redrawn in the dev container, on the very Chromium build
  CI runs and on the same Ubuntu 24.04, and every one still failed on CI: the container breaks some
  lines of Inter a word differently. So **when the lane on a pull request disagrees with a baseline
  drawn here, believe the lane**, and take the actuals from that pull request's `visual-diffs`
  artifact (checking its digest). It is why the update bot leaves `@playwright/test` alone
  (`.github/dependabot.yml`): each release brings new browsers, and the baselines are redrawn from
  the upgrade's own CI render, by hand.
- **The repository's Playwright can be ahead of the dev container's browsers**, as it still is on
  13 Nov 2026. Until a container carries the pinned release's browsers, a local run needs the
  environment's remedy: launch Chromium with `executablePath: '/opt/pw-browsers/chromium'` from a
  scratch config that imports the project's, giving `testDir` and the web server's `cwd` as absolute
  paths. Nothing in the repo changes. WebKit takes `npx playwright install webkit`, about a minute. CI
  and the deploy gate install their own browsers and need none of this.

### Every browser job is pinned to Ubuntu 24.04

GitHub's `ubuntu-latest` moved to Ubuntu 26.04 in late October 2026. Every job that starts a browser
says `runs-on: ubuntu-24.04`; the list and the reason are written once, on `e2e.yml`'s smoke job.
Playwright supports 26.04 now, so what holds them is the baselines: they are CI's own render on
24.04.

**Deferred:**
- **Move them all together**, as their own change, with every Chromium and WebKit baseline redrawn
  on the new image — from CI's own render, since nothing here draws 26.04's. One job left on 24.04
  would test a browser the others do not.
- **`install-browser-deps` still reports success when Playwright declines to install.** Its fallback
  `exec`s the plain command, which exits 0 on an image it does not support — on 26.04 under the old
  Playwright the libraries step passed and the WebKit tests then failed at browser launch, hundreds of
  them. A check that the browser launches would name the failure at the step that caused it.
  `workflow-hygiene.test.mjs` pins the fallback's shape, so that is a change to the test as well.

### Playwright's WebKit crashed on a navigation after a Back — whether Safari on a phone does is unchecked

Playwright 1.56's WebKit (build 2215) crashed its web process on a cross-document navigation made
after two `history.pushState` calls and a `history.back()` — the shape of any exit taken from a
dialog opened over the drawer (the drawer's entry, the dialog's entry, the dialog closing). The
repository's Playwright no longer has the fault (re-run 3 Nov 2026), so **this entry stays for one
question: Safari on a phone is not believed to share it, but nobody has checked on a device.** To
check: Admin → change a row → ☰ → Calendar → **Leave**.

The Leave test (`admin: a drawer pill or the logo asks before leaving staged edits`, in
`e2e/admin.spec.js`) still stops the navigation at the network with a `204` and asserts the request
Leave made — correct on either build — and the test after it proves the destination. **Never skip
such a test on WebKit**: it is the lane's only view of the dialog, the drawer and the guard on
Safari's engine. The reproduction is in `ROADMAP_HISTORY.md`.

## Security

> **Forward plan.** The security work is sequenced, with per-phase risk and rollback, in
> **`SECURITY_RELEASE_PLAN.md`** — the single source for what has shipped, and the ordering that keeps
> a fix from re-creating the v10.94 outage (task #2's post-mortem, `ROADMAP_HISTORY.md`). The entries
> below are the constraints that still hold, and the reasoning behind them.
>
> | | |
> |---|---|
> | **Still deferred** | **App Check** (Track D — declined as immediate, retained; see its entry below) · **password retirement** (Track C5, gated on the migration reaching ≥90% — `MAINTENANCE_CALENDAR.md` → Trigger points) |

### The document FILES are protected by a bearer URL, not by auth
`storage.rules` gates direct Storage SDK reads, but staff never read Huddles, Circulars or Newsletters
that way — they open a URL that carries its own access token and **bypasses the rules entirely**
(documented in `storage.rules` itself: "Don't store confidential files here unless the delivery
model changes"). The direct reads are **admin-only**.

**Which URL depends on one IAM grant.** The three opening surfaces ask `getDocumentUrl` for a
short-lived signed URL, used only when it names the file the page is holding
(`resolveDocumentOpenUrl`). Without `roles/iam.serviceAccountTokenCreator` on the runtime service
account every call answers 503 and they fall back to the **permanent tokenised `storageUrl`** in the
Firestore document — kept as the fallback by owner decision, so a member can open the document either
way (DECISIONS.md). The grant is very probably in place: `unlockCalendarViewer` runs as the same
account and depends on the same grant (RECOVERY_RUNBOOK.md → 5b). Confirm by opening a document and
looking for `storage.googleapis.com` rather than `firebasestorage` in the opened address.

**That fallback can go dead, and Check says so.** A document's stored link can come to name a key its
file no longer carries: a browser's upload write re-sent after its acknowledgement was lost puts the
upload's first link back over one Operations → Document links had replaced (`documents-client.js` says
why that write is not guarded), and a document saved more than a day after its file can miss the key a
run took away. Members still open the document through the 15-minute link; only the fallback above is
broken. Document links → Check counts such documents and says so, and Replace gives each one a working
link (`functions/doc-link-rotation.js`).

**Tightening the Firestore read rules does not put these documents behind authentication.** It
changes who can *discover* a URL; anyone who has ever held a permanent one — a forwarded link,
browser history, a synced bookmark — keeps access until the object is deleted or rotated, and
revocation means rewriting the object, not editing a rule. Rotating the objects already in
circulation is the open step — built as Operations → Document links, not yet run (ARCHITECTURE.md →
EXC-007).

**Document retention bounds it, but is not a guarantee.** Both retention sweeps DELETE the Storage
object, which is what kills a bearer URL: **Huddles at 3 months** (`pruneOldHuddles`, server-side,
`functions/huddle-retention.js`), **Circulars and Newsletters at 6 months** (`pruneOldDocs` in
`doc-retention.js`, browser-side). Three things stop that being a guarantee, and they are the
residual risk:

- **Neither sweep is scheduled.** The Huddle sweep runs inside `ingestHuddle`, so only when an emailed
  Huddle arrives; the Circular and Newsletter sweep runs fire-and-forget after an upload of that kind
  (`documents-client.js`). If uploads stop, nothing prunes, and "6 months" becomes "6 months after
  somebody next uploads". The right long-term home is a scheduled Function.
- **No server time, no sweep.** `doc-retention.js` refuses to run on a client clock, deliberately —
  correct, and it means the sweep can silently not happen.
- **A partial failure ORPHANS the Storage object.** Both sweeps delete Firestore first, then Storage,
  because the reverse leaves a user-facing broken link. The accepted cost is an orphaned object —
  invisible to staff, unreferenced by any document, and **still serving its bearer URL**. Since v25.89
  the Huddle sweep tries again in the same run (`sweepHuddleOrphans`), but no later run returns to a
  date whose document has gone, and the Circular and Newsletter sweep has no such step. That is the
  one genuinely unbounded case. Operations → Document links counts such files among those "no longer
  used by the app", and a run there is the only step that switches their links off.

**And there is a second reader nobody authorised.** Word circulars and newsletters open via
`officeViewerUrl` (`storage-utils.js`), which passes the URL to **Microsoft's Office Online viewer** —
Microsoft fetches the document **server-side**. So these documents reach a third party today, which
is worth knowing independently of any auth work, and Microsoft cannot fetch an auth-gated URL. The
viewer is handed the SIGNED URL, so it was kept by owner decision (AUTH_PLAN.md §5, 19 Sep 2026)
rather than replaced.

### Real payslip figures stay in git HISTORY (owner decision, recorded not accepted)

The pay-maths regression fixture — thirteen of a named colleague's actual payslips — is the gitignored
`test-fixtures/payslip-actuals.local.js` since v23.71, and `sw-asset-check.test.mjs` guards the
`.gitignore` rule that keeps it out. That stopped it being SERVED: the GitHub Pages mirror serves the
repository root and obeys no ignore list.

**It does not close the history.** The figures remain in every commit up to v23.71, and in the
SERVED `roster-data.js` before v14.68 — so anyone who clones the public repository can still read
them, and GitHub has already served them to whoever asked.

Scrubbing was considered and declined in the same decision, on cost rather than principle: a
`filter-repo` rewrite changes every commit SHA on `main`, which breaks existing clones, stales every
commit and PR-diff link in these documents, and cannot recall bytes already served or cached by
third parties. The remaining exposure is a public repository the owner chose to have — the same
reasoning already recorded for the base roster's public classification (AUTH_PLAN.md §2).

**What would actually close it**, whenever the repository's visibility is revisited: making the
repository private, which also retires the Pages mirror as a side effect and therefore cannot
happen before that migration (OPERATIONS_REFERENCE → "Which address staff are on" measures how far
it has got).

### No restore has ever been TESTED — and the portable export is still not set up

Backups themselves are not the gap: PITR and a managed schedule are on, and a run confirmed both
against the live project on 19 Sep 2026 (`ROADMAP_HISTORY.md` has that story). **What remains is
that a backup nobody has restored from is a belief, not a capability.** Two gaps:

- **The restore path is unexercised, though it is WRITTEN DOWN.** It lands in a **NEW** database,
  because `(default)` cannot be overwritten from a backup, so the real sequence is restore → verify →
  cut over, and nobody has walked it. The first attempt should not be the day it is needed.
  **`RECOVERY_RUNBOOK.md` → "5. Rehearse once" → "6. The RESTORE DRILL"** holds the procedure: the IAM
  the deploy account probably lacks, the scratch-database restore, what to verify (and the check that
  catches a restore silently containing today's data), the one-document cutover nobody has practised,
  and the step people forget — **deleting the scratch database**, which bills and is a second copy of
  everyone's data. Writing it changes nothing about whether it has been RUN.
- **Section 3's portable GCS export is still not set up.** PITR and managed backups both live inside
  the same project; an export to Cloud Storage is the copy that survives losing it.

**Why this is recorded as a limitation rather than a task.** A restore drill on a live Firestore
project costs real money and real care, and its value is proportional to how likely the loss is —
which PITR has reduced considerably. It is a legitimate thing to decide not to do; what is not
legitimate is believing it has been done. `MAINTENANCE_CALENDAR.md` has no row for a drill, and
adding one is the owner's call.

### Named colleagues' leave figures remain in git history, and no guard classifies `docs/`

The depot workbook's per-person reconciliation log is `docs/AL_WORKBOOK.local.md`, gitignored, so it
is no longer served (the Pages mirror serves `docs/`; Firebase's ignore list covers it). The
committed `docs/AL_WORKBOOK.md` keeps the method, the four cell states, the workbook's own defects
and the worked examples, each with its figures and reading *"a member"*; its remaining names are a
workbook-spelling ↔ app-spelling map carrying no figure, and both spellings are public by the
classification in `AUTH_PLAN.md` §2. What still holds:

- **The log is still in git HISTORY**, exactly as the payslip fixture is (above), so this stops it
  being SERVED, not published. Rewriting history is the owner's call and has not been taken.
- **A fresh checkout does not carry the log**, so a session in a new container starts without the
  accumulated reconciliation history — a real cost to the `/al-workbook` workflow, accepted
  deliberately and reversible by un-ignoring the file.
- **The public classification was reasoned about SHIFT PATTERNS** — *"shift patterns are on the
  station's own printed rosters"* (`AUTH_PLAN.md` §2). A leave balance is not on a printed roster,
  and it is a different class of personal data about a third party.
- **No guard CLASSIFIES what `docs/` publishes.** `public-data-classification.test.mjs` covers the
  world-readable roster files and not `docs/`. `payroll-anonymity.test.mjs` scans the whole tracked
  tree, Markdown included, for a roster name sitting beside a payroll term or a leave balance — the
  class that went wrong, a NAME next to a FIGURE. It is not a classification guard: a new personal
  field in a doc that never names anybody passes it, and so does a name beside something neither
  vocabulary lists.

### A row comment that said too much about a colleague remains in git HISTORY

From v22.41 until the whole-app fix (10 November 2026), the comment over one row of the world-readable
member table (`roster-data.js`, then `roster-member-data.js`) said more about that colleague than
their roster move, and `docs/MAINTENANCE_CALENDAR.md` said it again. No file in the tree carries it
now. What still holds:

- **Git history keeps it, as it keeps the two exposures above — and so does one commit's SUBJECT
  line**, which every list of the repository's commits shows and no file edit reaches. Rewriting
  history, or that subject, is the owner's call and has not been taken.
- **The guard that now exists reads only the member table.** `roster-data.test.mjs` fails on a
  comment there about a person's circumstances, wherever the name sits. `payroll-anonymity.test.mjs`
  matches a name and a term on ONE line, which is how this one passed it.

### Admin/manager password is surname-derived (F-SEC-1) — the owner chose leave-as-is

Every account's Firebase Auth password defaults to the member's surname (lowercased, non-alpha
stripped, padded to ≥6 — `normaliseSurname`), derived from the public display name. So the **admin**
and **manager** accounts — which can do everything, or write on behalf — are guessable by anyone who
knows the app URL and the surname convention (stated in the login hint), **until each has set a
password of its own**.

**Owner decision: leave-as-is** (July 2026). A targeted fix was scoped — a real secret for those
accounts, with a client login branch and a `setupRosterAuth` guard so the break-glass reset does not
clobber it — and not built: the exposure is impact-high but **likelihood-bounded by the unadvertised
URL and a small known team**, matching the surname-password posture ("passwords are surname-derived
and not secrets; protection relies on Firebase Auth rate-limiting + Firestore rules"). The
staff-wide replacement is Track C in SECURITY_RELEASE_PLAN.md.

**The fix is available and one action away, not automatic.** Every account can set its own secret in
Settings → Password, and sign-in falls back to the surname only while an account is still on the
default — which subsumes the targeted fix. The master admin account has its own password
(owner-reported, 25 Jul 2026), so that exposure is closed in practice. What stays open is the
**management accounts**, which can write any member's AL, absence and shifts on behalf; a staff
account can write only its own overrides, so its blast radius is one person's roster. Closing it
needs no code — each manager opening Settings → Password — and Operations → Account status shows who
has migrated; verify there rather than trusting this paragraph. The surname is not *retired* until
Track C5 (≥90% migrated).

**Revisit when:** the app URL is advertised more widely, or it becomes official Chiltern
infrastructure — then confirm the admin and manager accounts have set their own passwords, and
sequence Track C for staff-wide migration and surname retirement. Do not treat the guessable admin
password as fixed until those accounts have actually set a secret; it is an accepted, bounded risk
with an available fix, not an automatically closed one.

### CSP connect-src uses the `https://*.googleapis.com` wildcard — narrowing was tried and reverted
`connect-src` deliberately keeps the broad `https://*.googleapis.com` wildcard. Narrowing it (A6,
F-SEC-6) to the four hosts the app was believed to contact (`firestore` / `identitytoolkit` /
`securetoken` / `firebasestorage`) **broke the deployed-CSP CI proof** (`e2e/csp.spec.js`, the `csp`
job in `e2e.yml`) and was reverted: on CI's real network the SDK contacts **additional
`*.googleapis.com` sub-hosts** the list omitted (the Firebase App core, or a service such as
`firebaseinstallations.googleapis.com`). The local `npm run test:csp` run was a **false pass** —
behind the dev container's outbound proxy the real SDK never completed the network init that reaches
the extra hosts.

**So the wildcard stays.** It permits only Google-owned `*.googleapis.com` origins, `script-src
'self'` already blocks injected script, and this is defence-in-depth with no live vector — not worth
the breakage. **If narrowing is retried:** first capture the COMPLETE host set from a real-network
run — read every `blockedURI` from the CI `csp` job (or a browser with the narrowed header on a live
network), not a proxied dev run — then list exactly those hosts in `firebase.json` AND every served
page's `<meta>` CSP, and confirm the CI `csp` job (not just local) goes green.

### GitHub Pages mirror — CSP via `<meta>`, with two residual header-only gaps
The staff mirror at `garethdavidmiller.github.io/roster-app/` is served by GitHub Pages, which
**cannot serve custom HTTP response headers at all**, so the `firebase.json` CSP header — and every
other security and cache header — never reaches the mirror. Every served page therefore carries a
`<meta http-equiv="Content-Security-Policy">` mirroring the header (`csp-meta-parity.test.mjs` keeps
them in lockstep, `e2e/csp.spec.js` proves it at runtime). On the mirror the meta is the only CSP,
and it covers **all resource-loading directives**. **Residual gaps on the mirror only — accepted, and
a reason to retire it:**
1. **`frame-ancestors 'none'` (anti-clickjacking) cannot be expressed in a `<meta>` CSP** (browsers
   ignore it there), and GitHub Pages sends no `X-Frame-Options`, so the mirror could be framed. A
   clickjack drives the VICTIM's own session; what limits it is browser storage partitioning — a
   third-party frame gets its own empty storage, so the framed app is signed out.
2. **`Cache-Control: no-cache` is not applied** on the mirror; GitHub Pages sends `max-age=600`. Its
   consequence is handled in the service worker, which never rewrites a cached file and fetches a miss
   `no-cache` (`service-worker.js`).
Both close if the GitHub Pages mirror is retired (the stated long-term direction).

**`X-Robots-Tag: noindex, nofollow` travels the same way**, mirrored into every page as
`<meta name="robots">` — and here the meta is the *only* option: a `robots.txt` is honoured only at
an ORIGIN root, and the mirror lives under `/roster-app/` while `garethdavidmiller.github.io` itself
is a different repo. Enforced by `sw-asset-check.test.mjs` ("every served page carries the noindex
meta"). Adding a new page means adding both metas; both guards will tell you which one you forgot.

### localStorage session can be forged for UI access (#14)
The `myb_admin_session` localStorage session can be modified in DevTools to impersonate another user
or reach the admin UI. A forged local session does not by itself create a Firebase Auth identity: the
write pages require the member's OWN named Firebase session, and a session that cannot establish one
is bounced to re-login rather than proceeding as a nameless guest. `overrides` writes require
`memberName() == memberName || admin || manager`, where `memberName()` is the BOUND name — a password
sign-in at the name's own email carrying the server-set `member` claim ("The member claim", below).
**Never quote the raw `token.name ==` form:** copied into a new rule it reopens the self-set
display-name hole. The named password is still surname-derived by default, so this remains
hardening, not full remediation. Local UI checks remain non-security controls. Practical risk is low
for a small known team. Status of record: `SECURITY_RELEASE_PLAN.md` → B2/B3.

### A signed-in session lasts 60 days regardless of use (owner decisions — accepted trade)

`SESSION_MS` in `session.js` is absolute, set once at sign-in, and the only clock: there is no
inactivity cutoff (two owner decisions, recorded in `ROADMAP_HISTORY.md` — the absolute bound is not
what protects an account, below, so its length is a UX dial). **Do not restore an inactivity cutoff** on the
assumption it was load-bearing; it was deleted rather than left dormant for exactly that reason.
`session.test.mjs` pins the replacement properties: a long-untouched session inside its window is
still valid, a read leaves the stored session byte-identical, and a newly written session holds
exactly `name`/`ver`/`expiry`.

**What reads FROM this number, and gets further away as it grows:**
- **The forced password migration** (`CONFIG.FORCE_PASSWORD_SET`, PASSWORD_DESIGN Track C) is driven
  by sign-ins, so full coverage takes up to 60 days — the C5 exit metric converges at the session's
  pace.
- **Operations → Usage, "Accounts that have signed in — last 30 days"** counts sign-ins, not people:
  someone can sign in once and use the app daily for two months without re-entering the window. The
  card's note says "counts sign-ins, not opens", and the reasoning beside `_appendSignInSection`
  states the direction. Do not restore an active-people claim unless the window is derived from
  `SESSION_MS`.

**What this does not change.** Every path that genuinely REVOKES access is immediate and was never
the session clock's job: an explicit sign-out (`clearSession`, which signs Firebase out too), a
disabled or deleted Firebase account, revoked credentials, and the `CLAIM_EPOCH` sweep. The
**Calendar viewer** is not a member session, holds no `name` claim, and its persistence is
session-only, so it ends when the browser session does.

**What it does change, stated plainly.** A LEAVER whose device still holds a local session keeps the
signed-in *UI* for up to 60 days. That was never the control it looked like: the real remedy is
Operations → Set up accounts → "Disable accounts for leavers", after which the ID token stops
refreshing (≤1 hour) and every authenticated read and write fails, and the Admin page independently
blocks a signed-in name that is no longer a selectable roster member. So the exposure is bounded by
the account disable, not by the local timer — which is why the timer's length is a UX choice, not a
security one.

**One interaction to expect on iOS.** `decideAccess` grants `named` only when a live local session
is backed by a **restored Firebase identity** — both halves, because either alone is a real failure
(see `calendar-access-core.js`). A device can hold the session without the identity, and that member
gets the member sign-in card ("This device needs to sign you in again…") instead of their roster,
never the PIN. A silent re-sign-in is tried first, and one tap on "Sign in" re-establishes the
identity, so it is recoverable rather than a lockout — but it will generate a support question, it
will land on iPhone users specifically, and it is worth expecting rather than diagnosing.

**The case where the same tab also held a staff-PIN session is closed (v25.98).** The start-up
decision now answers a held member session with the member's card, never the PIN, as the late-restore
path already did (`decideAccess`, `CALENDAR_DATA.md` 11). The paragraph that recorded it is in
ROADMAP_HISTORY.md → "Closed limitations, moved out of KNOWN_LIMITATIONS.md (13 Nov 2026)".

**The cause is NOT Safari's seven-day rule** (corrected 7 Nov 2026, iPhone audit — this paragraph and
five module headers said it was). WebKit's tracking prevention deletes ALL of a site's script-writable
storage together, in a Safari tab, after seven days of Safari use without a visit: IndexedDB,
localStorage, sessionStorage, the service worker and its caches. It cannot leave the local session
behind, so its victim arrives signed out on what looks like a new device, not at this card; and an
app on the Home Screen keeps its own day count, which moves only on the days it is opened. The
likelier route here is an IndexedDB read that fails — WebKit closes IndexedDB connections in hidden
pages, and Firebase Auth then falls back to localStorage, where no user is stored — which nobody has
confirmed on a device. The handling above is right whatever the cause. What the seven-day rule really
costs iPhone users is the entry **"iPhones keep two separate copies of what the app stores, and Safari
clears one of them"**, beside the iPhone status bar entry near the top of this file.

### The four v11 security tasks — task #1 still binds; the other three are history

**Task #1 — every domain the app is served from must be in the GCP API-key referrer allowlist.** The
Firebase web API key is visible in page source (normal for client-side Firebase) and is restricted
to HTTP referrers in GCP Console → APIs & Services → Credentials → Firebase web API key. The
allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*`

**A missing domain fails without naming the cause:** every Firebase Auth call from it is refused
(`auth/requests-from-referer-...-are-blocked`), so every Firestore write fails for every user on that
domain. Nothing in the app says why: a typed sign-in says only "Couldn’t sign you in. Try again — if it
keeps happening, ask the admin." This is what happened in May 2026, when the domain most staff use was
left out, and then the app showed no error at all. If a custom domain is ever added, add it to the
allowlist in the same change.
CLAUDE.md carries the same rule.

**Tasks #2–#4** — per-member write isolation (shipped strict; the v10.94 outage post-mortem), the HPP
variable-pay split (#3: London Allowance and basic pay accrue no HPP — the rule is now
`.claude/rules/paycalc.md` invariant 6), and the pay reminder push (verified live) — are in
`ROADMAP_HISTORY.md` → "The four v11 security tasks", with task #1's history and its curl
verification.

### Deep-review residuals (July 2026) — accepted / inherent, not code-fixable

A max-effort deep review (July 2026) found **no critical, high, or security defect**; the actionable
low-severity findings were fixed in the same pass. These remain **by nature** — architecture or App
Check territory, or inherent platform behaviour, not bugs to patch:

- **A native `<select>` has no deterministic height until you give it one.** `line-height: normal`
  on a `<select>` resolves from the font the control is laid out with: the calendar's measured 17px
  on most loads and 20px on some, on identical code in one browser, which surfaced as a
  visual-baseline flake. The exact trigger was never pinned down (a font-load race was disproved);
  the DEPENDENCY is established, and stating a line-height removes it. Almost every select the app
  shows is now a `select-sheet.js` button over a hidden value holder, which has no such behaviour.
  **What survives applies to the selects that are native BY DECISION** (`select-sheet-parity.test.mjs`
  holds the list with each reason): none has been measured and none carries a tight visual baseline,
  so the one-line fix is available and not worth moving pixels for. A native control's box is the
  platform's, and the app stops depending on it only by not using it.
- **Analytics dynamic-map value integrity.** `analytics/activeAccounts`, `analytics/origins` and
  `analytics/perf_<month>` hold maps whose keys and values Firestore rules cannot iterate or
  type-check, so an authenticated session (a named member or the PIN viewer) could write forged
  counts. The rules validate SHAPE and block key-removal (the destructive wipe), the `pv_` counts are
  int-checked, and the App Speed card reads a value only when it is a whole number under a million
  (`perf-stats.js`); the usage readers take a non-number as zero. A forged but PLAUSIBLE count is
  still indistinguishable from a real one — App Check territory, on non-sensitive, admin-only
  aggregate counts.
- **`passwordSetAt` vs `resetAt` is a two-system stamp, not atomic.** A sub-second interleave of a
  member's self-set and an admin reset can momentarily misreport the "migrated" chip. It self-heals
  on the next set/reset and stores no password material. The chip is a monitoring signal, but
  `resetAt` itself is a CONTROL: a device's silent sign-in is refused against it (AUTH_AND_SESSIONS.md
  23), so every path that puts an account back on its surname default writes it FIRST, and changes
  nothing if it cannot.
- **An open Huddle viewer can hold a superseded link.** Two Power-Automate runs for one date send one
  push (a transaction closes the check-then-act race), and the push carries only `/#huddle`, so the
  viewer opens whatever Huddle is current at the tap. What remains is a viewer already OPEN, holding a
  link that has since been superseded.
- **`style-src 'unsafe-inline'`** stays in the CSP — the app sets inline styles from JS, and style
  injection is far lower-risk than script (which is fully locked down, no `'unsafe-inline'`). The
  `connect-src` `firebasestorage.googleapis.com` entry is redundant under the `*.googleapis.com`
  wildcard but kept for explicit readability (harmless; the hygiene test tolerates it).

### The App Speed record can fill in a month of many releases — shown, not prevented

Each month's speed counters live in ONE Firestore document, keyed by app version among other things,
so every release adds keys — September 2026 shipped about a hundred versions. Firestore refuses a
document over 1 MiB or 20,000 fields, and the write that would cross either is refused; the app
swallows that error, as best-effort analytics must, so the card would simply stop changing for the
rest of the month. The counters are exempt from indexing (`firestore.indexes.json`), which removed
the nearer 40,000-index-entry ceiling, and the card states how full this month's record is
(`perfRecordFullness`), in amber from three quarters. **Not built: a cure** — the cheapest is to stop
recording the connection class, which every key carries and nothing reads (DECISIONS.md → "The App
Speed card answers live questions only"); the others are sharding the record by week, or folding old
versions into one key. Nothing yet says the limit is near; the line is how anyone would find out.

### The Usage counts are a trend, and not comparable across v25.00 — accepted

The Usage card review (v25.00, Oct 2026) changed what three of its figures count, so a month either
side of that release is not the same measure:

- **Page views** stopped counting the reload the app does by itself after an update — about one
  Calendar open in seven in September. October and earlier read higher for that reason alone; the
  card says so under Page popularity while either window it can show predates the change, and stops
  saying it by itself once both are later.
- **"Last 30 days"** counts each member-device on its LATEST active day (`rollingMove`,
  `usage-stats.js`). It used to freeze the count on the first day for 30 days, which missed roughly
  1 in 30 daily users, 1 in 6 weekly and 1 in 5 monthly (simulated). Expect it, and the address bars,
  to step up as devices update — not growth.
- **The station PC counts.** A device nobody is signed in to records the page view, and a
  member-device only for a staff member's row.

What stays inherent: a moved count is a `+1` on today and a `-1` on the day it left, in one write. If
the original `+1` was ever lost (a write refused or dropped offline), the `-1` lands on a day that
never had it and the window reads one short until that day leaves the window — so a negative day
bucket in the `activeAccounts` or `origins` document is that, not corruption, and the card clamps
every sum at zero. Device-level dedup also means one person on two devices counts twice, and clearing
browser data counts again; these were always true and the card's ? panel says so.

### The App Speed card's "First appears" cannot mean the roster — inherent

First Contentful Paint is defined by the browser as the first pixel of content, and on the Calendar
that is the **splash** — inline markup in `index.html`. It has never measured the roster and no change
to this app can make it, because the splash is deliberately the first thing painted. So the card
carries a third milestone, **Usable**, which each page marks when its own content is on screen
(`markPageReady` in `perf-reporter.js`), and labels `domReady` "Code loaded", because
DOMContentLoaded can fire while the Calendar is still blank behind its asynchronous access decision.
What remains inherent:

- **"First appears" is still the splash.** Kept because it is genuinely useful — it is the
  difference between a slow network and a slow app — but it is not "the member can see their
  roster", and reading it as that is the trap this note exists to close.
- **"Usable" is a smaller population.** An open where somebody had to sign in or type the staff PIN
  first records no "Usable" (its sign-in is the figure), and Overtime skips the mark when its own
  state read fails, so its cell can still show a dash rather than a number. The smaller total is not
  fewer opens.
- **Historic data cannot be backfilled.** The metric starts at v20.80, so a month-over-month
  comparison across that line has no "Usable" figure on the earlier side.

### Two card-collapse systems — owner decision, not drift-by-accident

paycalc's collapsible cards animate open (`.collapsible-body` + `.card-toggle-arrow`, a `max-height`
reveal) while the other card pages use the shared `.card-collapsible-body` + `.collapse-chevron`,
which is `display: none/block` — instant. Same interaction, different feel depending which page you
are on. The shared header was promoted to `shared.css`; the BODY behaviour stayed per-page, which is
how the split survived.

Left as-is because converging it is a design choice, not a bug fix, and both directions cost
something: making the others animate inherits the `max-height` reveal's weakness (it eases toward a
fixed ceiling, so short cards finish early and the easing reads wrong), while making paycalc instant
removes a nicety staff already have on the page they use most. Worth an explicit decision rather than
a silent sweep.

### A deliberate burst of reset requests can still show who asked recently — bounded, still open

`requestPasswordReset` answers a recorded request and a throttled repeat with the same body, and
neither before `RESET_REQUEST_ANSWER_FLOOR_MS` (3 s), so timing cannot say who is locked out right now.
One push per burst is decided in a transaction, and a large DELIBERATE burst can still hold a recorded
request on Firestore's locks past the floor while a throttled one meets it (review, 11 Nov 2026: the
claim's retries are capped at two, which is why the floor is 3 s and not 2 s). What bounds it: every
name such a burst probes is recorded as a request the admin sees, and each name can be probed once in
ten minutes. Closing it fully means sending the push from a Firestore trigger, so no answer waits on it
— a new deployed function, left for a release that needs one. App Check (below) would also blunt it.

### Three settings outside the code that nobody has checked from here (sign-in audit, 13 Nov 2026)

The sign-in audit could read the code and the rules, not the Firebase console or the live network.
Three things it depends on are therefore assumed, not known:

- **Who may change or delete their own account.** Every staff-PIN holder signs in to ONE shared
  viewer account. If users may delete their own account, or link an email to it, one PIN holder can
  end every station's PIN at its next token refresh. Nothing is exposed — the next unlock rebuilds
  the account (`viewerAccountTamper`, AUTH_AND_SESSIONS 20) — but each station has to enter the PIN
  again. Firebase console → Authentication → Settings → User actions.
- **Email enumeration protection.** With it off, Firebase's own sign-in API can say which roster
  addresses have accounts. The addresses are derivable from the public roster, so this tells an
  outsider little, but it is a free signal. Same page.
- **The address the PIN lockout counts by.** `unlockCalendarViewer` counts failures per source by the
  LAST `x-forwarded-for` entry, which a caller cannot forge. If the hosting puts its own address
  last, every caller shares one failure budget (`maxFailures`, `calendar-viewer-auth.js`) — a cheaper form of "Anybody can hold the staff PIN
  shut" (above), not a way past the PIN. Reading one real request's headers in the function's logs
  would settle it.

### A lost-phone reset still leaves two narrow gaps (sign-in audit, 13 Nov 2026)

Operations → Reset asks "Their phone is lost or stolen". Ticked, no reset notice is sent — it would
land on that phone's lock screen — and every push record the account owns is deleted. Two gaps remain:

- **The surname opens the account until the member chooses a new password.** A reset is the only
  tool that signs every device out, and it puts the password back to the surname default, which the
  sign-in card's hint names. For a member who had chosen their own password, that is a door the
  finder did not have before the reset. It closes the moment the member signs in on another device
  and chooses a new one, and the outcome asks the admin to arrange exactly that. Closing it fully
  needs an action that signs every device out WITHOUT touching the password — a new endpoint, and an
  owner decision. Not built.
- **A revoked phone can save its push record again for up to an hour.** A revocation takes effect
  when the ID token next renews, and the push-record rule cannot see it, so a phone opened in that
  hour can save its record again once its daily re-save is due. Nothing re-checks it later, as the
  leaver sweep now does for leavers (`disabledLeaverUids`). A rule comparing the token's `auth_time`
  with `resetAt` would close it. Not built.

### Firebase App Check — declined as an immediate action, RETAINED as Track D

> **`SECURITY_RELEASE_PLAN.md` → Track D is authoritative for whether and when.** App Check is NOT
> closed: it was declined as an immediate action and kept in the security plan, sequenced last.
> Track D answers the objection below that caused the decline — **monitor-first** (D1 log-only:
> watch for legitimate-but-unattested traffic, register every domain and debug token, then enforce
> one product at a time) exists precisely because the silent-failure risk is real. What follows is
> the reasoning for the deferral, which is still the reasoning.

App Check (register the app's hosting domains so only requests from our own pages can reach
Firestore/Storage) was considered as a defence-in-depth measure and **declined as an immediate
action**:

- It is **not** a console-only toggle — it requires client-side SDK init in `firebase-client.js`
  wired to a provider (e.g. reCAPTCHA Enterprise), so it is a real code change with its own outage
  risk, not a 30-minute setting.
- It shares the **exact failure mode** of the API-key referrer restriction (task #1 above): miss a
  served domain (`web.app`, `firebaseapp.com`, `garethdavidmiller.github.io`) or hit a provider
  hiccup and writes start failing silently with no visible error in the app. The allowlist must be
  kept in sync forever.
- It gates *which clients* connect, not what an authenticated client may read, so it adds nothing to
  the `overrides` read boundary, which has required a member identity or the PIN's `calendarViewer`
  capability since 26 Aug 2026 (`firestore.rules`).
- Payoff for this threat model (unadvertised app, small known team) is low: it blocks scripted bulk
  reads/writes from outside our pages, which is a real but low-probability attack here. The Aug 2026
  external review recommended it for the telemetry and reset-request paths — the same
  defence-in-depth, sequenced-last position rather than a new argument.

**When to revisit:** if the app is advertised more widely or becomes official Chiltern
infrastructure.

---

## Pay calculator

### The pay-period grid ends on 12 Mar 2027 — extend it at the tax-year rollover, not before
`CONFIG.LAST_OFFSET` (`paycalc-periods.js`) stops at the last 2026/27 payday. Extending it needs the
2027/28 row in `TAX_YEARS`, the thresholds tables and the Student Loan tables, and most of those are
not published until early 2027 — adding a year now would mean guessing figures the calculator then
presents as fact, which is the one thing `.claude/rules/paycalc.md` forbids. The next pay award is not
needed: the year is added without it, and the award's figures follow once it is announced. It
is the existing "TAX YEAR ROLLOVER" step in `paycalc-periods.js`, due before the first 2027/28
payday (~9 Apr 2027); `MAINTENANCE_CALENDAR.md` carries the date.

### Not a payslip replacement
The calculator estimates take-home pay from staff-entered data. Actual payslips from
Chiltern may differ due to arrears, adjustments, and deductions not captured here.

### Pre-fill reads base roster + Firestore overrides only
The "Fill from calendar" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

### A backup made under a member's old name does not restore under the new one
A backup is filed under the name it was made with, so after a member is renamed on the roster it is
refused, and the member is told to contact the admin (`NOT_ON_ROSTER`, `paycalc-transfer.js`).
Restoring it as theirs would need a former-name record on the member. Not built (owner, 10 Nov 2026:
renames are rare), so a rename is handled by the admin when it happens.

### A back-pay lump on an un-entered payslip is left out of "This tax year so far"
The year summary skips a paid payslip with no saved hours wholesale (it is listed under "Not entered
yet"), so its opt-in lump is skipped with it, while the result card shows the lump. Judged correct
rather than broken: including only the lump from a payslip the member has not filled in would make
the "N of M entered" count and the money disagree. The HPP lump behaves the same way, and
`paycalc-year-summary.test.mjs` pins it.

## Calendar / roster

### Team View summary chips — considered and declined
A summary chip strip showing aggregate counts per week (e.g. "Working 10 · AL 2 · RDW 1")
was considered for Team View. Declined: the working environment uses the grid for individual
planning, not aggregate operational analysis. The dense row grid already gives sufficient
at-a-glance clarity. Do not re-add without a specific operational use case from Gareth.

### Override cache is never cleared on member switch
`rosterOverridesCache` in `calendar-overrides.js` is keyed `"memberName|date"` and accumulates
overrides for all members without a size limit. It is not cleared when the selected
member changes — and a switch fetches nothing: the read is by DATE for every member at once
(`calendar-overrides.js`), and `fetchedMonths` is keyed by month. So the map grows with the months
visited in a session, not the members viewed — unbounded in principle, small in practice.

### An override still carries a `note` field that nothing writes and nothing reads

Every override write sends `note: ''`, and no save path has ever offered a field for one; the display
paths were removed on the owner's decision (nobody used the feature, and free text about a named
colleague is a GDPR exposure with nothing to justify it). **The field stays on the write, and that is
not an oversight:** `firestore.rules` requires `note is string`, and a missing field is null, so a
client that stopped sending it would permission-deny **every override write on every device**.
Retiring it is a three-push, backend-first sequence whose two rules clauses fail in OPPOSITE
directions; any order but the one beside `buildOverrideWrite` in `override-utils.js` (and in
`docs/DATA_MODEL.md` → overrides) breaks writes. Low priority — the residual is a field that is empty
everywhere and displayed nowhere — but only cheap to remove while somebody remembers the ordering.

### The text-scale tiers are proven against a STATED scale, not a real Android setting

`text-scale.js` measures how much larger than the stylesheet's sizes the phone is drawing its text,
and the calendar's two control rows tighten from the tier it stamps. The pure rules are unit-tested
and the rows are driven through a real browser at a spread of width/scale pairs — but every run
states the scale through the `window.__E2E.textScale` seam and then scales the fonts itself, because
a headless browser has no OS text-size setting to turn up. So the suites prove that *when the page
believes the text is 1.3×, the rows respond correctly* — the RESPONSE, not the DETECTION.

**Measured:** at the DEFAULT text size the probe reads exactly 1.0 in a real browser, so nothing is
stamped and no phone gets a compact row it did not need — `line-height: 1` is what makes that
font-independent. **Not confirmed on a real device:** what the hidden 16px probe reads at a Samsung
"Largest" or a Pixel accessibility font size. If a colleague on a large text setting reports two
rows, suspect the probe before the CSS: the response is pinned, the detection is not.

### Under large text the month heading is HELD at its size — a compromise, not a pattern

`html[data-text-scale] .month-year { font-size: 21px }` in `index.css`: once the phone's text is
1.1× or more, the heading's base drops from 24px so that after the phone scales it back up it still
shares a line with the week note. At "Large" (1.15×) that lands at roughly the original 24px — the
member asked for larger text and this one heading stays where it was. The owner's decision was one
line ("like it used to be"), and for this row the trade is right: the week note is 12px metadata and
the heading is a two-word title that a member reads by shape. **Do not extend the pattern.** It is
a way of resisting an accessibility preference, and it is defensible only where the words are few,
the size stays legible, and the alternative row costs a whole line of the calendar. Body copy, the
day cells, the Team View grid and every other page keep scaling as the phone asks. If another
surface ever seems to need it, the answer is a second line, not another compensating rule.

### Shift DURATION in the day panel — considered and declined

An external review proposed a "9 hours" line under `07:00–16:00`, or better a paid figure, with its
own caveat attached — and it was declined on the strength of that caveat.

**The app has no paid-hours model, and a clock figure is not one.** Breaks are not in the data; the
pay calculator works from hours a member ENTERS per period, never from a shift's start and end. So
the only number available is the clock difference — which a member reading it on the panel they
trust most would reasonably take as paid, and it is not. That is the same failure as stating "As
rostered" over an unread month, running the other way: a confident figure the app has no basis for.

It is not blocked by difficulty. `admin-shift-rules.js` already computes shift length correctly,
midnight crossings included, and reusing it would take an afternoon — which is what makes this worth
writing down rather than leaving to be rediscovered as an easy win. **If a real paid-duration rule
ever exists in the data, revisit; until then a duration line is a number with nothing behind it.**

### Duplicate Firestore override documents
If a date has multiple override documents for the same member, the cache keeps a manual change
over a roster-import one, and otherwise the most recently created (`shouldReplaceOverride` in
`override-utils.js`). Duplicates are not logged; find and clean them up at source in the Firebase
Console. (Manual duplicates from before the fixed per-day ids are also cleared when Admin next saves
or deletes that day — "Two editors on one day", above.)

### Deleting an AL doc destroys the swap evidence it carried
An AL written over a swapped-in day is the only surviving record of the swap (`replacedType` — the
`shift` doc itself was deleted by the booking). Cancelling that leave via Saved Changes or the
period delete removes the AL doc, and with it the record: the day reverts to base REST. Leave
re-booked on it later is then asked about as any rest day is — was it a swapped working day? — so it
costs a day only if the person booking still knows about the swap (`.claude/rules/admin.md` → "AL on a
rest day is ASKED about"). Not coded around, deliberately: the same deletion
makes the calendar visibly WRONG (the member is contracted to work a day now showing Rest), so
the manager's natural next action — re-recording the shift — restores both the display and the
evidence in one step. Restoring it automatically is impossible anyway: the shift's TIME was never
preserved, only its type. If a cancelled-leave-on-swapped-day case ever recurs without the
re-record, that is the signal to store more than the type.

### A device that missed the ended-month release in November may open on November once in December
The Calendar keeps the month on screen between visits, but since the whole-app fix (November 2026) it
never stores the CURRENT month (`persistViewedMonth`, `calendar-state.js`). So a month that has ended
is not brought back as though somebody had browsed to it. A device that did not open a release
carrying that change during November may still hold a November stored by the release before. That
month cannot be told from one browsed back to, so the Calendar opens on November until the member
moves to another month. It cannot happen again after that.

---

## Navigation / accessibility

### No `inert` behind dialogs (focus is trapped; the background is not inert)
Every dialog traps Tab/Shift+Tab — the nav panel and every lightbox through `createLightbox` (`overlay.js`) — and each is declared `role="dialog" aria-modal="true"`. Screen-reader users can still reach page content behind the overlay via browse mode: `inert` on background content is deferred (its only uses are local, in `admin-roster-upload.js` and `admin-week-editor.js`). Android and iOS are both first class here, so this matters to TalkBack and VoiceOver alike.

### The drawer does not pull back focus the iPhone keyboard's arrows move out of it
The ‹ › arrows above the iPhone keyboard move focus to the previous or next text field in the document
and fire no key event, so a Tab trap never sees them. Since 7 Nov 2026 every `createLightbox` dialog
pulls such focus back (`_guardFocus`, `overlay.js`); the nav drawer, its two lightboxes and the Huddle
viewer keep their own Tab traps and have no guard, so the arrows can leave the drawer's *Search the
guides* box for a field behind it. Not built yet: `nav-panel.js` was at its line cap when this was
found, and has room now. The device check is in `IPHONE_RELEASE_CHECKLIST.md` → B.

### On an iPhone, reloading a guide opened at a heading goes back to that heading
A guide opened at a `#heading` (a drawer search result, a card link) lands below the sticky header, and
the guide scripts never pull back a reader who has since moved (guides-4, Nov 2026). A RELOAD is the
exception on WebKit: Safari scrolls to the `#fragment` again itself, where Chromium restores the reader's
place. The app moves nothing afterwards — `e2e/guides.spec.js` → "a deep link does not pull back a
reader who has moved, or a reload" passes on both engines — so the "or a reload" half holds on Android
and not on an iPhone. Countering it (taking over `history.scrollRestoration`) would mean the app
fighting Safari's own reload behaviour on every guide page for a rare gesture, so it is recorded
rather than built (whole-app check, integration-e2e, 10 Nov 2026).

---

## PWA / service worker

### PWA shortcuts — and the manifest `name` — require reinstall to update
Changes to `manifest.json` shortcuts do not take effect on existing installs until the user
reinstalls the PWA (removes and re-adds it to the home screen). The same is true of `name`, which
Chrome's pre-Android-12 splash draws as text in the device's system font: an installed phone shows
the current short "Marylebone Roster" only after a reinstall regenerates its WebAPK
(`.claude/rules/pwa.md` says why it is short and ASCII).

### Printing from the installed app on iOS 27 does nothing — so the app says so
In a home-screen web app on iOS 27, `window.print()` is a no-op: no print sheet, no error, no
`beforeprint`. The same tap in a Safari tab prints. WebKit bug 325259 (25 Sep 2026) places the
fault in Apple's web-app shell rather than the engine, and no page-side workaround exists. Every
print control in the app goes through `print-guard.js`: on an installed iPhone or iPad the tap
explains and offers "Open in Safari" (one tap, the same page) instead of silently doing nothing.
Every Android install keeps its print. **Every iOS home-screen launch gets the explanation, iOS 26
and earlier included:** WebKit freezes the user agent's iOS version, so no page-readable signal tells
iOS 27 from 26, and an older install that could print is sent to Safari too — a dialog, against a
button that does nothing (`print-guard.js` says why). **When Apple ships the fix there is no version
to raise** — retire the guard only once an installed iPhone is seen to print. **Unconfirmed on a
device:** whether `window.open` from the home-screen app lands in Safari itself or in the in-app
Safari sheet; both can print from the share menu.

### Samsung Internet’s Dark mode repaints the app dark — the opt-out it ignores, and the per-device answer
Reported 23 Oct 2026 from a Samsung phone: the Calendar’s off-white cards and day cells turned dark
grey, dark text turned light (the navy month heading light blue), every tinted cell darkened with its
hue kept, and the navy header untouched. That is a browser’s **forced-dark algorithm** repainting the
page, not a theme in the app — the app has none, by decision (`.claude/rules/css-tokens.md` → "No dark
mode"), and nobody can switch one on inside it.

**The app already declares the opt-out browsers define for this, both ways:** `color-scheme: only light`
on `html` in `shared.css`, and `<meta name="color-scheme" content="only light">` on every served page
(`page-contract-parity.test.mjs` fails a page without it). Chrome honours it — its auto dark theme
skips a page that says `only light`. **Samsung Internet does not.** Its Dark mode (its own setting, or
following the phone’s) darkens any site that offers no dark theme of its own, ignores `only light`, and
Samsung’s developer relations have said there is no page-side logic that bypasses it. A copy installed
to the home screen from Samsung Internet keeps Samsung Internet’s engine, so it is repainted the same
way; one installed from Chrome is not.

**What it costs.** Nothing in data or logic, and the roster stays readable: every cell carries its
word or emoji as well as its colour (the WCAG 1.4.1 rule the app already follows), and the algorithm
keeps hues, so Early is still orange and Late still blue, only darker. What is lost is the design —
and a member may read it as a fault, or as a feature somebody enabled.

**The answer is per device, not in code.** The colleague turns Dark mode off in Samsung Internet
(under Settings → Appearance, or Labs, depending on the version — the menu moves), uses Chrome, or
installs the app from Chrome. **The one thing that stops the algorithm in code is a real dark theme**
(`prefers-color-scheme: dark`), which Samsung Internet would then use instead of its own. That reverses
the no-dark-mode decision across every page stylesheet and is declined for this; ROADMAP.md → "Dark
mode (toggleable)" is where it would be reopened. Do not answer the report with a darker palette or an
inverted-back override: the algorithm runs on the computed colours, after the stylesheet, and would
repaint the repair too.

### An update can still land mid-way through the forced change (sign-in audit, 13 Nov 2026)

The forced change's password write, and the record that follows it, are counted as writes in flight
(`trackBackgroundWrite`, claim-retry.js), so a release's reload waits for them on the pages whose busy
check reads `writesInFlight` — Admin, Settings and Operations. The Calendar holds an update's reload
while it is on screen anyway. The Pay Calculator, Trains, New link, Links and Overtime do not ask, so
an update arriving in the second the write takes reloads them under it. The cost is small and
self-correcting: the member is asked to choose a new password again at the next sign-in. Asking on
every page means changing the service worker's start-up on all of them, which was not worth the risk.

### Service worker activates immediately (`skipWaiting`)
`self.skipWaiting()` means a new SW takes over all open tabs at once.
In the rare case this causes a mid-session race, a hard reload resolves it.

### Mixed-version cache window during a deploy — mitigated, not fully closed (accepted)
During the brief window between a new version deploying and a client fully reloading onto it, a page
can in principle pair one version's HTML/JS with another version's — an "interface-incompatible" mix
that can throw. The exposure is **already narrow and mitigated**, not silent:

- **Same-version serving:** HTML, JS, and CSS are all served from the one version-pinned cache
  (`myb-roster-v{APP_VERSION}`), so a normal page open is single-version by construction.
- **Newest-older fallback:** when an asset misses the current cache and cannot be fetched (offline,
  or a mid-deploy hosting hiccup), `matchNewestManagedCache` serves the **newest available older**
  cache — not the oldest one `caches.match()` would pick — and routes the HTML and JS fallbacks to the
  *same* older version, staying as close to single-version as the caches allow.
- **Reload lifecycle:** version bump → new SW → new cache → warm-up → `controllerchange` reload
  (`sw-register.js`) converges every client onto the new version; roster **data** is always live from
  Firestore regardless of the cached JS version.

**Residual (accepted):** a *partially-warmed* current cache can still pair a fresh module with an
older fallback for that one window, and a `beforeReload`-deferred reload (e.g. admin mid-edit) runs
old JS against a claimed new SW until it reloads. **Fully closing this is a deliberate scope
decision** — it needs either per-file version markers (the cheap HTML-comment marker was removed
because it made the version bump touch ~8 files on half of all commits) or per-page-load version
coordination with a self-heal reload (a reload-loop hazard) — **both live in the highest-outage-risk
file (the SW)**, so the risk of a rushed change exceeds the (rare, self-resolving) bug. Revisit only
if a real mixed-version incident is observed in the field.

### Dual hosting: web.app is canonical, and the github.io mirror is where most staff still are
The app is served, identically, from **two** live origins:

- **`https://myb-roster.web.app`** (+ its alias `myb-roster.firebaseapp.com`) — Firebase Hosting.
  **Canonical and primary**: the URL to hand staff for any *new* install, and the origin written into
  Cloud Function notification payloads (`STAFF_SITE_URL`).
- **`https://garethdavidmiller.github.io/roster-app/`** — the GitHub Pages mirror (the roster-app
  repo's own native Pages). **Still live, not retired, and still the origin MOST staff use** (owner,
  Sep 2026) — the move to the canonical URL is gradual by design. Note the `/roster-app/` sub-path. It
  serves no redirects and no HTTP headers, so anything leaning on either reaches the minority of users
  rather than the majority.

**Why both can coexist safely:** push *delivery* is origin-independent (every subscription in
`pushSubscriptions` is fanned out regardless of which origin it came from). The notification
*tap-through* is made origin-correct by the service worker, which discards the payload's origin
and re-bases the target page onto its **own** `registration.scope` (see `notificationclick` in
`service-worker.js`). So a github.io install taps through to github.io, a web.app install to
web.app — `STAFF_SITE_URL`'s origin only supplies the path + hash.

**Both origins must stay in the GCP API-key referrer allowlist** (`web.app`,
`firebaseapp.com`, `garethdavidmiller.github.io`) until github.io is deliberately retired —
dropping one silently breaks all Firebase Auth on that origin (task #1 above).

**Retiring github.io later** (optional, no deadline): confirm all staff have reinstalled from
web.app, remove the github.io entry from the allowlist, and turn off Pages in repo Settings. Delete
`.github/workflows/deploy-mirror.yml` in the same change: it fails, by design, when it cannot read the
Pages setting, so with Pages off every Hosting release would open a deploy-failure issue.
**Two things depend on it first, and both are silent if forgotten:** Pay Calculator figures are
stored per address, so staff must move them with 💾 Move Your Pay Data before they move
(OPERATIONS_REFERENCE.md); and the New link page's PDFs are served from the mirror (`PACK_BASE` in
`newlink-config.js`), because Firebase serves nothing under `docs/` — move them to a served folder.

### ⚠️ The installed PWA masks live-site breakage — verify the URLs, not your phone
Because the app is offline-first, an installed PWA launches (and updates) from the service-worker
cache. It keeps working even when the **live deployment is completely broken** — a splash that never
clears, a `404`, a CSP violation, an expired or missing API-key referrer entry. You will **not**
notice from your own installed app, which is exactly how the June 2026 outage went unseen (Firebase
URL stuck on splash, GitHub Pages staff URL returning 404, while every installed phone carried on
fine).

**Therefore: never treat "my phone works" as evidence the site is up.** Always test the **live URLs
in a fresh browser / private window** (no SW, no cache) — the canonical URL checklist and cadence
live in **CLAUDE.md → "Deployment health check"** (both origins past the splash, a sub-page
deep-link, no red console errors). Re-run it after any change to `firebase.json` (CSP/headers), the
Firebase SDK version in `firebase-client.js`, the GCP API-key referrer allowlist, or the hosting
setup.

**One red line is the policy working, not a fault** (measured 12 Nov 2026). LEAVING a page that holds
an open Firestore connection — the Calendar, opening a guide from the drawer — can log a refused
`www.google.com/images/cleardot.gif`. That is Firestore's own transport testing the network after the
connection closes. The policy is right to refuse it and nothing on screen changes; `e2e/csp.spec.js`
names it as that pixel's second source. It shows on a fresh load only if *Preserve log* is on, since
Chrome clears the console when the page changes.

**It is also checked by a machine, on a four-hourly schedule** — which GitHub, running schedules as
capacity allows, keeps about three times a day. `live-health.yml` runs `npm run test:live` on a
GitHub runner: a real browser opens root, `admin.html` and `paycalc.html` on BOTH origins and asserts
served, splash down, something usable on screen, no console errors. It demands a DIRECT connection
(`LIVE_REQUIRE_DIRECT=1`) — the spec's curl-relayed fallback cannot see the referrer restriction, so
on a schedule it fails rather than passing weakly. A page still failing a minute later, when the check
looks again, is reported on the open `deploy-failure` issue; one that has cleared by then is only
noted on the run (`live-health.yml` says why). This is a different question from the hourly
`production-currency.yml`, which compares the served VERSION against main and reads a stuck splash
as "current". The scheduled run does not replace the manual check after a `firebase.json`, SDK or
allowlist change; it bounds how long an outage nobody was looking for can last.

**Any deploy-ignore pattern must exclude *only* dev and test files — never match a file the app
imports at runtime.** That outage was a `**/*.mjs` in `firebase.json`'s hosting `ignore` dropping
the runtime `purify.es.mjs` from every Firebase deploy (the story is in `ROADMAP_HISTORY.md`). No
test guards this direction: when adding a runtime asset with a test-like or tooling-like extension,
confirm no `ignore` glob in `firebase.json` catches it.

---

## Huddle ingest

### Power Automate HTTP connector is Premium
The Huddle ingest flow requires the Premium HTTP connector in Power Automate.
The standard "Send an HTTP request (Office 365)" connector does not work here.

### File type detection uses filename extension, not Content-Type
Power Automate sends `text/plain` for both PDF and DOCX attachments.
The `ingestHuddle` function detects file type from the `X-Huddle-Filename` header
extension, not from `Content-Type`.

---

## Roster data

### The base-roster drift detector is BLIND on a flat pattern — measured 60% coverage

`detectShiftedRow` (`roster-alignment.js`) is the import's check against the member's own base
pattern, and **its coverage is not uniform: for some members it is zero.** It correlates the parsed
week against the base pattern at offsets −1/0/+1 and requires a ±1 alignment to beat offset 0 by ≥3
matches — evidence that exists only where a week has SHAPE. On a flat Mon–Fri line —
`RD · 09:00–16:00 ×5 · RD` — a one-day shift moves two cells, never three, so the detector correctly
reports nothing. There is no defect to fix here: the signal is genuinely absent, and lowering the
threshold would trade silence for false refusals across the rotating links where it does work.

**Measured 2 Sep 2026** over every active member across ten consecutive weeks, both shift
directions: **538 of 900 one-day shifts detected, 60%.** Three members were blind in at least 18 of
their 20 sampled cases — **S. Boyle, C. Reen and S. Faure**, all on flat fixed lines — and anybody
else on such a line (a member moved onto one, a trainee's weeks) is in the same position. So the
population that is hardest to check by eye — the people whose weeks all look alike — is exactly the
population this check cannot speak for.

**What still covers them is the PDF's own grid.** On the geometry path the grid assigns every day by
coordinate (`functions/roster-prompt.js`), so a row cannot shift at all. When an upload falls back to
the PDF path — any member the grid cannot place turns it off for that document — the geometry witness
(`functions/roster-geometry.js`) is positional rather than pattern-based and still refuses a claim in
an empty cell; and when `geometry.status` comes back `unavailable` these members have **no
independent check at all**, which the review states (`geometryCopy`, `roster-alignment.js`) rather
than leaving silent.

**Why it is recorded rather than fixed.** Any fix means either a second pattern-independent witness
or a weaker threshold, and the second is the one that makes the import worse. Worth revisiting if a
flat-line member is ever the one a misread week lands on.

### A rest day read for an empty weekday is believed on the PDF path — and a printed RD is never checked

**The rule:** a blank cell is an ANSWER on Sunday (the uncontracted column; its blank is how the sheet
says "not working") and a QUESTION every other day, because Mon–Sat unworked days are always stated
explicitly (RD, AL, SC, SN, OD, HA, ML, CL, NA). `buildSafeEntries` implements it, and the prompt asks
for a `BLANK` token and forbids the model from interpreting it (`roster-prompt-parity.test.mjs` stops
the old "a blank cell = RD" instruction coming back). `.claude/rules/roster-import.md` is the
contract.

**Closed on the geometry path.** There the server knows which cells are physically empty, so a rest
day read for an empty Monday-to-Saturday cell goes to the review (`reviewRestReadsOfEmptyCells` in
`functions/roster-prompt.js`, 7 Nov 2026), and so does an empty read of a filled cell
(`reviewBlankReadsOfFilledCells`, beside it).

**What still holds:**
- **On the PDF path** — the fallback whenever the grid cannot place every member, including a member
  legitimately absent from that week's sheet — the safety rests on the model doing as it is told. If
  it writes `"RD"` for a physically empty weekday, nothing downstream can distinguish that from a
  printed RD, and the day imports as a rest day. The geometry witness cannot refute it either: an
  `RD` is exactly the value an empty cell is consistent with. The review table bounds it — every
  import is shown to an admin first.
- **On both paths, a printed duty read as `RD` in an OCCUPIED cell is not checked.** Telling a
  printed RD from a printed duty means READING the text, which is phase 3 of `ROADMAP.md` → "Roster
  import". Nor can the witness see a shifted row whose week is fully occupied: on the geometry path
  such a row cannot shift, and `assessRosterAlignment` covers the PDF path.

**Do not rebuild the cross-check on the column scan.** It was built, and the existing fixtures
refused it: one real CES row scans as `['blank', '06:00-14:00', 'OFF', 'blank', '07:00-15:00', '-',
'blank']` against a row read of `OFF` for every one of those days, so the scan uses `blank`, `OFF`
and `-` interchangeably for the same kind of cell, and a scan `blank` is not evidence the cell is
empty. The row read, the Sunday scan and the column scan are one model looking at one PDF in one
call; the independent witness is the PDF's own geometry. The reasoning is in
`applyColumnScanCrossCheck`'s header (`functions/roster-parse-helpers.js`), where whoever tries will
meet it.

**Worth watching on a live Dispatch import.** Over the 12-document geometry corpus (1 Sep 2026,
`experiments/roster-pdf-geometry`), blank Mon–Sat cells are 1 in 678 on CEA, none on Supervisors,
and **48 in 324 (15%) on Dispatch**, across four people who appear on that sheet and work most of
their week elsewhere — exactly the case the rule exists for, since writing RD across them would
overwrite what their primary roster's import had just written. Their blank Sunday is not taken as an
answer either: when every Monday-to-Saturday cell of a row is unread, the review treats the Sunday as
unread too (`computeCellStates`; a decided default, November 2026). So a Dispatch import sends roughly a
dozen rows to the review, each answerable in place. If that proves tiresome, the question to ask is
whether a member blank Mon–Sat on a SECOND sheet should be skipped wholesale rather than cell by cell
— a product decision, not a bug.

### On the PDF path the Sunday scan outvotes the row read and the column scan

When the row read and the column scan both read a shift in a Sunday cell, and the Sunday scan alone
reads it empty, `applySundayScanCorrections` (`functions/roster-sunday-repair.js`) treats the row as
slid. The documented order makes the Sunday scan the final authority on Sunday. If the Saturday was
read empty, the week moves a day right; otherwise the Sunday is disputed, and the geometry witness or
the review settles it.

**Measured** over synthetic weeks (whole-app check, November 2026): of 53,248 single wrong Sunday-scan
readings, 4,096 end with values on the wrong day. Where the geometry witness can read the PDF's grid,
it refuses the row in 3,440 of those and misses 656.

**Recorded rather than changed.** The order exists because a lazily copied column scan agrees with a
drifted row, and on that row the Sunday scan is the only read that saw the empty cell. The geometry
path asks for no scan, so none of this applies there.

### The sheet's own week is checked only where its heading can be read

`checkSheetWeek` (`functions/roster-week-heading.js`) reads the sheet's printed `Week Ending:
DD/MM/YYYY` heading, in the layout measured on a real CEA sheet (owner, 10 November 2026). It refuses
a sheet for another week before anything is written. Three cases go unchecked:

- **The CES and Dispatcher sheets** have not been measured, so whether they print the heading is not
  known.
- **A scanned sheet** has no text layer to read.
- **A grid read that never settles within its budget** reads nothing.

In each case the upload goes on as it did before the check existed, and the Functions log says "the
sheet's own week was not checked". A whole week out there is caught only by the admin.

### Cloud Function payday constant duplicated from `roster-data.js`
`functions/roster-parse-helpers.js` contains its own `FIRST_PAYDAY_MS` and `INTERVAL_DAYS`
constants (inside `isPayCutoffDay()`, which `functions/documents.js` imports) for the pay-reminder
scheduled notification. These must stay in sync with `CONFIG.FIRST_PAYDAY` and
`CONFIG.PAYDAY_INTERVAL_DAYS` in `roster-data.js`. If the pay schedule ever changes, both files
must be updated. The correct long-term fix is a shared JSON config consumed by both, but the
no-build constraint makes this awkward. `payday-cutoff-parity.test.mjs` fails if the two drift, so a
payday change that updates only one side cannot pass CI.

### Cloud Function staff list is generated from `roster-data.js` — regenerate it in the same commit
`parseRosterPDF` name-matches the AI-parsed roster output against `STAFF_NAMES`, which is
**generated**, not hand-maintained: `functions/index.js` does `require('./roster-members.json')`,
and `roster-members.json` is produced from `teamMembers` by `scripts/generate-roster-members.mjs`
(`npm run generate:roster-members`). Never hand-edit it — the file carries no marker saying so, and
`sw-asset-check.test.mjs` fails on drift instead. So a new starter or leaver needs no manual edit in
`functions/`: update `teamMembers` in `roster-member-data.js` (re-exported by `roster-data.js`), then
run `npm run generate:roster-members` to rebuild the JSON in the same commit (the `/new-starter`
skill includes the step).

---

## Links design workspace — accepted constraints
The workspace's rules are `.claude/rules/links-design.md`. These are the things it deliberately does
not do, or cannot know:

- **Duplicate names are refused from the list you LOADED, not from the collection.**
  `links-design-naming.js` closes the case a designer can see: two rows reading "Option A" in a
  picker that drives Compare, Delete and the shared setups. What it does not close is the race. The
  check runs in the browser against the designs this page has fetched, so two designers holding the
  same list can each create "Option B" before either sees the other's document, and Firestore keys on
  a random id, so both writes succeed and neither person is told. The guarantee is therefore **"you
  cannot knowingly create a duplicate from the list you loaded"**, and not "duplicate names cannot
  exist" — worth stating because the refusal message reads like the stronger promise.

  **Not closed deliberately.** Closing it needs server-owned uniqueness — a transactionally reserved
  document whose id IS the normalised name, or the equivalent in a Cloud Function — which is real
  machinery for a workspace with a handful of designers who mostly work at different times, and it
  would have to fail somehow when the reservation and the design write disagree. The client rule
  already removes the case that actually happens (one person, one list, a name they can see). Revisit
  if the designer count grows or two people start working the same hour; the shape to reach for is
  `links-target-sets-store.js`'s transaction, which already refuses to land on a version nobody
  agreed to.

- **The rotation's length and cover weeks rest on evidence class C.** The new link's shape is the
  owner's account, confirmed verbally rather than in a document (`docs/links-26/RULES.md` says so, and
  advises getting the staffing levels in writing before a design is put forward). That is class C on
  ROADMAP.md's scale — fine for building against, and not something to put in front of an assessing
  manager as a requirement. It is recorded because the number shapes every figure the tool produces,
  and "why this many lines?" is a question a proposal will be asked. The 24-line period it replaced is
  in `ROADMAP_HISTORY.md`.

- **The run cap cannot always reach its target, and says so.** The "Most shifts in a row" box defaults
  to `DEFAULT_MAX_RUN`. With that switch on alone the reorder reaches it; with the full objective set
  on it may not, and the generator's status line states the achieved figure and names the shortfall
  rather than letting the box imply a guarantee. The real trade is **weekends off**: measured on the
  24-line default, every weight that reached the target cost 3–4 full weekends across the rotation.
  **This is an owner decision, not a settled one:** a longer run well inside the company's
  consecutive-day limit against fewer full weekends, which staff feel, is a judgement about conditions,
  so it is recorded here rather than tuned in code. Raising the weight is a one-line change if the
  answer is the other way (`.claude/rules/links-design.md` → the run-cap switch has the measurements).

- **Designs longer than the rotation are left exactly as they are.** They still load, render the
  rotation's rows, are analysed over the rotation — and, because the working copy deep-copies the
  whole patterns object, **save every line back**. Nothing trims them, deliberately: doing it on load
  would destroy lines of somebody's work on a page visit, and doing it on save would do it at the
  moment they least expect it. `#linksOverLengthNotice` states the two lengths and that the surplus
  rows are neither shown nor counted but are still stored. **Binning them is one press** — the
  admin's *Keep only the shortlist*, which bins every design saved before 2 Nov 2026 — and until it
  is pressed a designer can open one and work on a proposal that describes a link nobody is building.

- **The fatigue-factor panel is an AID, not a fatigue risk assessment.** This is the limitation that
  matters most on this page, because the failure mode is not a wrong number — it is a design showing
  few findings and being read as approved. The panel reports which of the ORR's p3 factors are
  *present*; the ORR is explicit these are not prescriptive limits, and the escalation it defines
  (justify why the factor cannot be avoided, minimise it, then assess and control the residual risk)
  is a human process the panel feeds and does not perform. Specifically:
  - **One definition is the owner's reading, not ORR's: FF19** renders "(definition to confirm)" on
    purpose. The owner chose "a rest day resets it", which is more lenient than ORR's wording ("avoid
    consecutive duties with large variations in start times", 7.71). On the strict wording every link
    with early and late weeks has FF19 — all 9 proposal sheets of 28 Sep 2026, where the owner's
    reading left 4 clear — so a manager quoting the FF19 figure should know whose reading it is. The
    other once-unsettled rows were checked against ORR's *Managing rail staff fatigue* (Aug 2024) on
    28 Sep 2026, and `links-fatigue.js` carries their readings.
  - **Every hours figure is a FLOOR.** SPARE days carry no times, so a standby day contributes zero
    to "hours in any 7 days". The real total is higher, and the panel says so on the row.
  - **Coverage is not completeness.** The factors the panel asserts as not-applicable are the
    night-shift family, and that rests on CEAs working no nights. It flips to live the moment any
    duty reaches 00:00–05:00 — but the p3 list is a good-practice summary, not the whole of fatigue
    risk, and nothing here models workload, commute, or individual circumstance.
  - **The baseline is the MAIN cycle at its own length.** "Today's link" is computed over
    `weeklyRoster` — the rotation the new design replaces — and the panel's summary names that
    comparator. The underlying rule still binds any future pairing: splicing two unrelated rotations
    end to end reports a longest run that belongs to the join rather than to either roster, so a
    design's figures only mean anything once its lines genuinely are one rotation.

- **The generator's objectives genuinely conflict, and no default is right for everyone.** Line ORDER
  is one scarce resource with several claims on it, and two of them are direct opposites: `gentle`
  minimises the week-to-week change, and taken to its limit that IS a long block of the same shift —
  the smallest possible step is no step at all. `variety` caps the block length. It ships with both
  on and variety weighted as a constraint, which lands on the live roster's own longest block.
  **Turning variety off gives long blocks**, the shape the owner rejected as "excessive and
  unpopular". The switches are the honest answer, not a better formula: the trade is real and the
  designer should be the one making it (`.claude/rules/links-design.md` → Line ORDER).
- **Interleaving the waves inside the generator is a WON'T-DO, measured.** It shortens the raw block
  length but puts a late wave's 23:55 Saturday beside a morning wave's 06:20 Sunday — a 6h25
  turnaround the construction was free of — and costs two long weekends for no gain. The generator
  owns the SHAPE, `links-adjacency.js` owns the ORDER. A test fails if the interleave returns.

- **The hard-limit check is a WORST CASE on a design, and it enforces nothing.** The
  consecutive-worked-days limit (`MAX_CONSECUTIVE_WORKED_DAYS` in `links-limits.js`) is **Chiltern's
  roster limit**, carried in company policy; its origin is the working-hours standard the industry
  adopted after the **Hidden report** into the Clapham Junction crash of 1988, and that standard was
  itself withdrawn in 2007 — so the row cites Hidden as an origin, never as a current industry
  requirement. It is not legislation. Unlike the ORR factors beside it, this one does pass or fail,
  renders red on a breach, and shows whether it passes or fails rather than collapsing behind the
  quiet-rows disclosure. Three things it does not do:
  - **It measures the LINK, not a person's actual roster.** A design is a pattern; what somebody
    ends up working is that pattern plus overtime, RDW, cover and swaps, none of which this page
    can see. A design that passes here can still produce a breach once real weeks are built on it.
  - **The answer is the worst case, which is a ceiling and not a prediction.** A spare week is four
    duties whose placement the roster clerk chooses week by week, so the figure is what the link
    *permits*. That is the right question for a hard limit — if any placement breaches, the link
    allows a breach — but the number is usually higher than what anyone works, and it must not be
    quoted as how many days in a row our people do.
  - **It rests on a spare week being four duties, Monday to Saturday** (owner, Aug 2026), with its
    Sunday counted as worked in the worst case, because it can be worked as overtime on top (owner,
    31 Oct 2026). If that ever changes — a different cover model, or a link where spare weeks
    routinely carry a fifth contracted day — every figure here moves, and `SPARE_WORKED_DAYS` and
    `spareDrawsOnFour` (`links-design.js`) have to move with it.

- **The generator and the grid lose their column headers on a PHONE.** Below 768px both tables sit in
  an `overflow-x: auto` wrapper so the table can scroll inside the card — and per spec, when one
  overflow axis is not `visible` the other computes to `auto` too. The wrapper therefore becomes a
  vertical scroll container as tall as its own content, and a `position: sticky` header sticks to a
  box that never scrolls. The declaration is present and inert. **Do not "fix" it with
  `overflow-y: visible`** — that is the exact declaration the spec overrides, so it would read as
  correct and change nothing. Measured at 390×844 the grid is about 43% off-screen horizontally, with
  no LINE/SUN/MON header on screen for most of the scroll, and the generator's SUN column and footer
  totals clip the same way. **Accepted rather than fixed:** the workspace's orientation panel says
  *"Best used on a desktop or tablet; the grid is tight on a phone"*, a tablet at ≥768px gets the
  working desktop layout (`links.css` says why the breakpoint is 768), and the real fix is a
  `max-height` and therefore a nested scrollbox around the primary editing path — a UX decision, not a
  tidy-up (`ROADMAP.md` → Links generator carries the open choice). Both states are pinned by an e2e
  that runs at both widths.
- **From 768px to about 830px, at Android's largest text, the grid cuts off its last totals column.**
  From 768px the grid's wrapper stops scrolling so that the day header can stick (`links.css`, the
  768px block, holds the measurements). Below 1024px the per-line totals' names and the days note may
  wrap, so the table fits its card at every width from 768px, at normal text and at 1.3× (`links grid:
  from 769px the grid stays inside its card, and at 1.3x text nothing is cut off`, `e2e/links.spec.js`).
  At 1.6× it does not. Android's Font size and Display size settings multiply, no width query can see
  them, and the table then needs 754px, so between 768px and about 830px the card's clip cuts the last
  totals column off with no scroll to reach it. **Accepted: the owner kept the sticky day header**
  (10 November 2026) over restoring the scroll container, which would lose it at those widths.
- **Coverage heat map counts pattern positions, not a named headcount.** Every position in the
  rotation is counted, including any line not yet designed. The design is patterns-only, so there is
  no distinction between named and unnamed positions. The heat map colour scale is relative to the
  week's own peak, so a lightly staffed day naturally shows cooler colours.
- **EVERY line rotates and must be filled.** In a rotating link everyone passes through every line,
  so an all-rest line is an *unfinished* line, not a vacancy — the link can't be authorised then
  re-cut each time a post is filled. The link is designed as a full rotation so it survives staff
  changes; C. Reen's adjusted fixed shifts are handled as overrides on the base roster, not in this
  designer. A Design-checks row and amber grid marker (`.row-unfilled`) flag any unfilled line until
  it is designed. The auto-generator produces a complete rotation in one step, and "Start with a
  blank grid" (`#linksEmptyNew`) and the importer (`links-import.js`) create a design without it.
- **The rotation LENGTH is hardcoded by design.** `ROTATING_LINES` reflects the agreed link concept —
  deliberately not derived from roster data — and is declared once, in `links-design.js`, and
  imported. If the link concept changes, the constant changes with it. **Do not write the number down
  here:** `links-rotation-parity.test.mjs` fails on a literal in the Links modules and `links.html`
  only. It does not read the docs, which is how stale figures survived in this file before.
- **Save concurrency is warn-on-conflict, not merge.** Two designers saving at once get a confirm
  naming who saved last; the whole document is still replaced. A field-level merge is not worth the
  complexity for a small design tool. Declining the overwrite offers **"Save mine as new"**, so the
  loser of a race has somewhere to put their work instead of choosing between discarding it and
  clobbering a colleague. The rules are the pure `links-concurrency.js`, tested with a case per
  historical bug. Residual: with the baseline unknown, two devices under the SAME display name will
  not conflict-prompt — inherent to identifying editors by name (`conflictOf`'s header).
- **The consecutive-day hard limit has no document citation yet, and the panel SAYS so.** ROADMAP.md's
  evidence gate requires class A or B before anything renders to a manager as "must be met", and this
  limit is class **C** — the owner's account of practice (Aug 2026). So the Design-checks heading
  reads "Configured Chiltern limits — policy source outstanding", and the row reports the measurement
  plus what to go and check instead of a verdict; the number, the separation and the red stay.
  `POLICY_SOURCE_CONFIRMED` in `links-limits.js` is the single home of that judgement — the heading,
  the row's `basis` and its prose are all derived from it, and tests fail in BOTH directions, so **the
  day the citation arrives is a test failure rather than a forgotten edit**. **What is still missing
  is the policy itself:** title, clause, which staff group it covers, and its effective/review date.
  To close this: get the policy reference, put it in `CONFIRMED_BASIS`, flip the flag, run `npm test`;
  the evidence contract in `links-limits.test.mjs` will then be checking a real citation rather than
  a plausible one. Related: the other limits in that family (max turn length, minimum rest between
  turns, the weekly ceiling) are already computed and rendered as advisory ORR rows — promoting them
  is a rendering change plus the confirmed figures. Do not do it from recall; see
  `.claude/rules/links-design.md`.
- **Delete is a SOFT delete and the bin is PERMANENT** (owner, 19 Sep 2026). A deleted design carries
  `deletedAt`/`deletedBy`, drops out of the picker, and is restorable from "🗑 Recently deleted" until
  somebody removes it by hand. **Nothing expires it and nothing will:** a soft-deleted design is
  already invisible and restorable, storing it costs almost nothing, and the only thing an automatic
  purge adds is the power to destroy a designer's work unattended — the exact failure the bin exists
  to prevent (and no client-side age check survives a device clock running fast). The expiry
  machinery was deleted rather than left dormant, so there is no constant for a countdown to come back
  from, and `doc-parity.test.mjs` fails if one is re-added without re-pointing its guard. A sweep, if
  one is ever wanted, would be a Cloud Function reading SERVER time (`.claude/rules/links-design.md` →
  Access control).

- **The generator's provenance is DEVICE-LOCAL** (external review, Sep 2026 — architectural, not
  fixed). Which target table produced a design — the remembered table, the saved set it came from,
  and whether it has been edited since — lives in `localStorage` under `myb_links_gen_<designId>`
  (`links-generator-targets.js`). So a colleague opening the same shared design sees the provenance
  note absent, not wrong: they cannot answer "what staffing was this built from?" without asking the
  person who built it, which is exactly the question an assessing manager asks. It is on the device
  because `firestore.rules` pins `linkDesigns` to a `hasOnly` list (`name`, `patterns`, `window`,
  `revision`, `updatedAt`, `updatedBy`, `deletedAt`, `deletedBy`) with no provenance field, so moving
  it is a **backend-first** change (rules that accept the field, deployed and confirmed, then the
  client that writes it — CLAUDE.md's parallel-workflow ordering), and it changes what a shared
  document asserts, which is a decision rather than a fix. Until then the note is one designer's
  working memory and must not be read as a property of the design.

## Overtime Availability — accepted gaps

Design: `OVERTIME_AVAILABILITY.md`. Operating: OPERATIONS_REFERENCE.md. These are the things the
feature deliberately does NOT do yet, so that a reader stops looking for them.

> **Paused** (`CONFIG.OVERTIME_ENABLED` is `false`): only the retention purge is deployed, so the
> scheduler, the push notices and the endpoints below are not running. Read this section as what the
> feature does when it comes back (`OVERTIME_AVAILABILITY.md` → Paused).

- **The SUNDAY-RELEASE REQUEST is recorded, and it is only ever a request.** A member rostered to work
  a Sunday can tick "Ask to be taken off this Sunday" on that week's availability form
  (`overtime-sunday-release.js`), the reviewer's list flags it (`releaseRequestLine`), and the server
  stores it as `releaseRequested: true` on that day's answer (`REQUEST_DAY_FIELDS`). What it does NOT
  do, deliberately: it writes no override, changes no roster and consumes no annual leave, and no
  surface words it as granted — `OVERTIME_AVAILABILITY.md` invariant 14. The roster team decides,
  outside the app, and the app records nothing about their decision. The server checks no roster when
  accepting one (a request is a fact about what was asked, and stays true if the shift later moves);
  it checks the CALENDAR instead, and refuses the field on any day but a Sunday.

- **"Away for a rostered Sunday duty" is therefore a REQUEST in the app, not an absence.** Sundays
  are uncontracted for every grade, so annual leave and absence cannot be written on one
  (`SUNDAY_FORBIDDEN_TYPES`) — correct, and it is what stops a Sunday costing somebody a day they do
  not owe. The depot's workbook can state the fact (a free-text `N/A <name>` tag in its Sunday row);
  an external review proposed a new non-entitlement absence type, and **the owner's answer was the
  request above**, which puts it where it is actually decided and invents no new kind of absence. Do
  NOT loosen the AL rule to close the remaining gap, which is that the DECISION is not recorded: once
  the roster team has taken somebody off, the calendar still shows the Sunday duty until the roster
  PDF for that week is imported or the shift is changed in Admin.

- **Expiry purge: dry-run until 1 Dec 2026, then automatic.** Windows past `retentionUntil` are
  filtered out of both read endpoints, so they are invisible and inert. Enforcement is in the
  endpoints on purpose: **rules are not filters**, and a `resource.data` condition would fail a
  reviewer's whole query rather than drop one row. The daily `purgeExpiredOvertimeWindows` job logs
  what it would delete and arms itself on 1 Dec 2026 (`purgeArmedAt`); see MAINTENANCE_CALENDAR.md
  and VAL-OT-001.

- **Nothing tells the REVIEWER who is outstanding.** Two targeted push notices go to members on their
  own — *you have been asked* when a window starts asking somebody, and *answers due today* on the
  morning of the initial deadline to participants who have submitted nothing — both addressed to
  resolved member uids and never fanned out. Nothing tells a clerk who is outstanding, so the
  *Awaiting a form* list and the **No response** section are the only answer to that question — which
  is why they must never merge into "not available". Operating detail: OPERATIONS_REFERENCE.md →
  "Nobody is asked silently any more".

- **The reviewer's workspace is a SNAPSHOT, not a live feed.** It states its own age, offers a
  Refresh, and re-reads when the tab becomes visible (debounced to a minute) — but it does not
  listen, so an answer arriving while a clerk watches the page does not appear on its own. That is a
  cost decision, not an oversight: a Firestore listener costs a read per arriving revision for every
  open workspace, which a restricted beta cannot justify. The signal that would change it is in
  `OVERTIME_AVAILABILITY.md` → "Evidence to gather during the beta".

- **Restricted audience — TWO lists, not one.** `currentAudience()` returns `'restricted'`, which
  selects eligible members holding the server-owned **admin** entitlement **or** named in
  `overtimeBeta`. Reviewing and participating are different things: a manager reviews without
  submitting, a beta tester submits without reviewing. Widening it is one edit in
  `CONFIG.OVERTIME_BETA` plus `npm run generate:roster-members` — the server reads its own copy, so
  an un-regenerated list gives somebody a page with no form on it.

- **An open window's population can GROW — and only before its first deadline.** Populations are
  frozen against removal and against late addition, but automatic creation would make "existing
  windows never change" mean "an invitation never takes effect": by the time anybody is invited, every
  week they could usefully answer already exists. So the nightly scheduler tops up windows that are
  still in `INITIAL_OPEN` — not every open window. Somebody added between the two deadlines would be
  reported as **No response** for a deadline that pre-dates their invitation, and the moment they
  submitted `deriveHistory` would label them **submitted after the initial deadline**; both describe a
  person who was asked and did not answer. The remedy is the phase, not a kinder label: they join from
  the next week whose first deadline is still ahead of them.

- **Name-keyed documents.** Participants and submissions are keyed by canonical member name for
  legibility. A rename would orphan them; the participant `uid`, stamped on first submission, is the
  recovery route. Nothing reads it today.

## Test coverage gaps
The suite is broad (`docs/FILE_INDEX.md` routes every suite, and `doc-parity.test.mjs` keeps that
complete); nearly every pure module has a companion `.test.mjs`. Every Cloud Function handler and the
Firestore read/write layer (`firebase-client.js`) now run in the unit lane against fakes — how each
gap closed is in `ROADMAP_HISTORY.md`. **Before adding new behaviour to `firebase-client.js`, add the
test with it.** A gap found and not closed belongs here; the pull request template asks for exactly
that.

**The coordinators have no unit tests, and that is a DECISION rather than a gap.** A coordinator is
what remains once the pure logic has been extracted, so `calendar-app.js` and `admin-app.js` are
DOM-bound by construction, and a unit harness for either would be a mock of the whole page. Their
decisive seams are wiring-tested in e2e instead, deliberately, and the tests say so in their own
headers: `e2e/calendar.spec.js` (`day detail:` block) pins `personalActionsAllowed` at its call site
and records the mutation that justified it, and `e2e/admin.spec.js` does the same for
`_syncMemberFor`. `page-contract-parity.test.mjs` pins every page's coordinator to calling the three
fire-and-forget writers — `initErrorReporter`, `recordUsage` and `recordPageLatency` — inside that
page's declared auth barrier, because a call made before an identity exists is rejected in silence
and the Error Log then looks healthy *because* it is broken. **Do not read "only e2e covers it" as a
shortfall here. That IS the wiring test** the "rule tested, the wiring not" risk in CLAUDE.md asks
for.

## Error Log noise filters

Not every uncaught error is a fault in this app, so several classes are suppressed before the
Firestore write by the pure `shouldReport` in `client-errors.js`: the opaque cross-origin
`Script error.`, browser-extension URL schemes, `ResizeObserver loop`, the declarative view transition
the browser abandoned, a service-worker background-update failure accompanied by a network phrase,
WebKit's IndexedDB teardown messages when they come from the SDK origin, and a cross-origin script
that is not one of the app's CDN origins. Each rule's reasoning is beside it in `shouldReport`. The
accepted cost is that a real fault worded exactly like one of these is not logged — which is why each
is matched as narrowly as it can be (exact phrases, an anchored match, the SDK origin only).

**Do not add a filter without a test on BOTH sides.** The failure directions are not symmetric: too
narrow leaves noise you can see and complain about, too broad silently swallows real errors and the
log looks healthy *because* it is broken. `error-reporter.test.mjs` pins each rule against the thing
it must suppress AND the neighbouring real error it must not.

## Error handling — silent catches audit

These silent catches are intentional. **Do not add new silent catches** — use
`catch(e => console.warn('[tag] message:', e))` for fire-and-forget paths so failures
appear in DevTools and the Operations Error Log.

### Intentional silent-catch patterns (correct)

| File | Location | Why silent is correct |
|------|----------|-----------------------|
| `nav-panel.js` | Circular / Newsletter fetch | The `.finally()` handler resets `_docFetching` and the `.catch()` renders "Couldn't connect" — the error is surfaced to the user; logging would be noise |
| `operations-errors.js` | Clipboard copy in Error Log | `.catch()` shows '✗ Copy failed' inline — user-visible fallback; no logging needed |
| `analytics-client.js` | `logClientError` call inside `error-reporter.js` | Logging a logging failure would recurse; the silent swallow is the correct terminal handler |
| `firebase-client.js` | Firestore persistence setup chain | Persistence is best-effort; the fallback to the memory cache is the documented Firebase pattern (it logs a `console.warn`) |
| `analytics-client.js` | `getClientErrors` resolved-record cleanup | Expired resolved records are pruned fire-and-forget; individual delete failures are inconsequential |
| `paycalc-app.js` | Firebase session failure before `initErrorReporter` | Error reporter is not yet initialised at this point; the silent fallback is the only safe option |
| `sw-register.js` | `registration.update()` calls (hourly interval, visibility-change, a bfcache restore) | SW update failures are not actionable — the existing SW stays active and the user experience is unaffected. Chrome also fires its own background update check that produces "Failed to update a ServiceWorker" unhandled rejections (suppressed by `shouldReport`); logging our own update attempts would add noise without benefit |

## Time-boxed maintenance (deadlines, not bugs)

Every dated obligation lives in **`MAINTENANCE_CALENDAR.md`**, each with a **warning point earlier
than its deadline** — "must be done by 6 April" reliably becomes "started on 4 April". Not duplicated
here: this heading is a signpost so a reader arriving from a code comment or an old link still finds
the work.

---

## Whole-app audit — deferred findings (v17.54)

A max-effort adversarial audit (seven parallel subsystem reviews) found **no high/critical bugs**. The
findings below were **deliberately not fixed** — they are latent, owner-territory, or within a
documented tolerance. Each is real; none is urgent.

- **Payday/cutoff crossing a year boundary is filed under the wrong year (LATENT).**
  `getPaydaysAndCutoffs(year)` files a payday/cutoff under the unshifted payday's year, but a paired
  cutoff (or a bank-holiday-shifted payday) can fall in the previous December; `isPayday`/`isCutoffDate`
  then look it up under the date's own year and miss it. **Unreachable under `MAX_YEAR = 2030`** (verified
  zero misses 2026–2030) — first bites ~2034. **Fix when extending `MAX_YEAR`** (`MAINTENANCE_CALENDAR.md`
  carries the date): key each entry under `formatISO(date).slice(0,4)`, or have `_get*Set(year)` also
  pull `year+1`'s first entry when its cutoff lands in `year`.

---

## The member claim — two optional console steps remain

A token's `name` is believed only on a PASSWORD sign-in whose email is the one that name derives to,
and only with the server-stamped `member` claim equal to it (`isMember` in `firestore.rules`,
`memberNameFromClaims` in `functions/member-identity.js`; AUTH_AND_SESSIONS.md invariant 19). No
display name, client call or sign-in method can produce `member`, so an account registered from the
client — at an invented name's address or a real member's — carries nothing the rules or endpoints
believe. **Set up accounts takes back** an existing account at a roster email that carries no custom
claim: it resets the password to the member's default, revokes every session and stamps `resetAt`
before it stamps the claims, and a take-back that fails stamps nothing, so the outsider is never
handed the claims. How it was built, in order: `ROADMAP_HISTORY.md`.

**What remains is hygiene in the Firebase console, not a control** — neither grants anything now, and
neither can be checked from the repository:
- **Client sign-up** can be switched off.
- **Anonymous sign-in** is recorded as still enabled on the project. The rules refuse an anonymous
  token everywhere and the app no longer signs in anonymously anywhere, so switching it off
  (Console → Authentication → Sign-in method) only removes it at source. A private-window check that
  the Calendar still loads afterwards remains cheap.

For a new starter, running "Set up accounts" promptly is still good practice, but it is no longer the
security control: an account registered at their email before that run is refused everywhere, and the
run takes it back.

## The new link page — two constraints

- **Its PDFs are served by the GitHub Pages mirror** (`PACK_BASE` in `newlink-config.js`), because Firebase Hosting
  serves nothing under `docs/`. Retiring the mirror breaks every pack link on the page; move the files into a served
  folder first.
- **Its audience is written twice.** `newlink-config.js` → `audienceNames()` says who the page is for, and
  `auth-policy.js` → `newlinkAudience` is the gate (open since v25.60), because `newlink-boundary.test.mjs` keeps
  the page's modules out of the one every roster page loads. `newlink-config.test.mjs` holds the two equal for every
  name, so setting `AUDIENCE` to the 26 means changing the role with it (OPERATIONS_REFERENCE.md → "The new link page").
