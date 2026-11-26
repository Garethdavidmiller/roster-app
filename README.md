# Marylebone Roster

A staff roster app for Chiltern Railways' Marylebone station: shifts, annual leave, overtime
availability (built, and paused for now), a pay estimator, and the daily operational documents. It is an offline-first
Progressive Web App — **vanilla JavaScript with no framework and no build step** — served as static
files, with Firebase (Auth, Firestore, Storage, Cloud Functions) behind it.

There is no `dist/`, no bundler and no transpile step: what is in the repository is what runs in the
browser. That is a deliberate trade, and the conditions under which it would be revisited are
written down in `CLAUDE.md` → "When a build step earns its keep".

## Reviewing this repository without installing anything

**The test suite runs on nothing but a Node binary.** From a bare checkout or an unzipped archive,
with no `node_modules` anywhere:

```
npm test                        # the default suite: hygiene + parse + unit
node scripts/test-nodeps.mjs    # every suite that needs no install, and it prints how many
```

Both print their own totals, so this page does not restate a number that would go stale. The second
command also names the suites it is skipping and why, and does not need npm at all. Almost none of the
estate depends on an install, whatever a failed install in a sandbox suggests.

### What genuinely needs an install, and what each lane buys

| Lane | Command | Needs |
|---|---|---|
| Cloud Functions handlers | `npm run test:functions` | `cd functions && npm ci` — these `require()` the real Firebase Admin SDK, and the roster-geometry suite drives the real PDF parser |
| Security rules | `npm run test:rules` | the Firebase emulator binary, plus a root `npm ci` |
| Lint, browser tests | `npm run lint` · `npm run test:e2e` | a root `npm ci` |
| Typecheck — the browser modules AND the Cloud Functions | `npm run typecheck` | a root `npm ci` and `cd functions && npm ci` — the Functions' types are firebase-admin's, firebase-functions' and Node's own |
| Signed-in browser journeys | `npm run test:signed-in` | Java 21 for the Firestore emulator, a root `npm ci`, `cd functions && npm ci`, and Playwright's Chromium and WebKit |

With a root install and the Functions install, `npm run check` is the full pre-push gate: lint, typecheck, then `npm test`.

### Do not substitute `npx tsc`

`npm run typecheck` runs the TypeScript version this project pins against two projects: `jsconfig.json`
(the browser modules) and `functions/jsconfig.json` (the Cloud Functions, CommonJS on Node, equally
`strict`). If that compiler is not installed — or the Functions' own install is missing, without
which every `require` of the Firebase SDKs reads as a missing module — the command **refuses and
says so** rather than reaching for `npx`: an unpinned compiler on a tree with no `node_modules` reports
missing-module errors for devDependencies that were never installed, which look like application
defects and are not.

What the typecheck actually covers — the service worker is the one area still outside both projects —
is recorded, with the measurements behind that decision, in `typecheck-scope.test.mjs`.

### There are no secrets in this tree

The repository is public and holds no credentials. Deploys authenticate through Workload Identity
Federation rather than a stored key; the Firebase API key is referrer-restricted; the retired
staff PIN's value lives only in Secret Manager, bound by no function, until the owner destroys it
(OPERATIONS_REFERENCE.md → "The staff PIN (retired)"). Keeping its digits out of the repository — and
out of the record of its retirement — is a rule, not a guard.

## The test lanes

What each lane proves, and what it cannot see. `CLAUDE.md` lists the commands; this is the detail
behind them.

**A test joins a lane by saying so, in one line near its top: `// @lane unit`** (or `hygiene`,
`functions`, `rules`, `parse`, `payslip-local`; a file may name several). Each npm script runs
`scripts/run-tests.mjs --lane <lane>`, which reads those lines (`scripts/test-lanes.mjs`), so adding a
test edits no shared list. A file with no tag, or a lane misspelt, fails `doc-parity.test.mjs`. The
lane is a choice: one that mocks a module (`mock.module`) needs `unit`, for its flag.

- **`npm test`** — `test:hygiene` + `test:parse` + `test:unit`: every file in `test/` except the
  `test:rules` suites and the `test:functions` suites that need `functions/node_modules`, on a bare
  checkout with nothing installed (above). `roster-parse-helpers` is pure, so it runs in both lanes.
- **`npm run test:nodeps`** (the same as `node scripts/test-nodeps.mjs`) — every suite that needs
  nothing installed. It prints how many suites it runs and which it skips, and its exclusion list is
  DERIVED from the `test:functions` and `test:rules` scripts, so nothing here restates either. It
  gates every branch and pull request as the `nodeps` job in `e2e.yml`, which runs it with NO
  `npm ci` and fails if `node_modules` exists at all — the absence is the test. A list the
  no-install suites need lives in a file that imports nothing (`e2e/touch-projects.js`), never in
  `e2e/helpers.js`, which imports `@playwright/test`.
- **The `test:payslip-local` script** — the real-payslip regression, which REQUIRES the gitignored
  fixture and FAILS without it. `npm test` skips that regression honestly when the fixture is absent,
  which is right for a public lane and means a green run cannot tell you whether the comparison RAN;
  this one can. Owner's checkout only, by design — run it before any pay-maths release
  (`.claude/rules/paycalc.md` → Example payslips).
- **`npm run test:functions`** — the Cloud Functions handler and roster-parser suites (every suite whose
  `// @lane` line names `functions`; it needs `functions/node_modules`). It gates every branch and
  pull request as the `functions` job in `e2e.yml`, on Node 24, the runtime `functions/package.json`
  declares — not the deploy tool's Node 20, a version the handlers never run on.
- **`npm run test:rules`** — the Firestore and Storage security rules against the emulator, which
  starts automatically.
- **`npm run test:e2e`** — the smoke suite in real headless Chromium (the dev environment's own
  build only if it matches Playwright's). The axe-core accessibility gate (WCAG A/AA, several states
  per page) runs inside it and is BLOCKING: `playwright.config.mjs` leaves out the csp, visual,
  offline, live and signed-in specs, not axe. **`npm run test:a11y`** runs that gate on its own; the baseline and triage
  are `docs/A11Y_BASELINE.md`.
- **`npm run test:csp`** — the deployed-CSP proof. It serves the app through the Firebase Hosting
  emulator with the real `firebase.json` header applied and asserts that real Chromium refuses
  nothing the app loads: the runtime counterpart to the static `csp-hygiene.test.mjs`. Not part of
  `npm test`; gated in CI as the `csp` job.
- **`npm run test:visual`** — clock-pinned, Firebase-stubbed, fixed-member screenshots of every key
  surface, compared against committed PNGs in `e2e/visual-baselines/`. It locks page composition (the
  accepted desktop voids included) against silent CSS and layout drift. It is sensitive to the
  environment, so it gates nothing: in branch CI it is REPORT-ONLY (`visual` in `e2e.yml`,
  `continue-on-error`) and always uploads its diffs. **That job's conclusion is `success` on a
  drifted lane and a clean one alike**, so the lane reports in two other places: one pull-request
  comment, updated in place and edited back when the drift clears (a workflow annotation on a push
  with no pull request), and its own check run, **`visual baselines`**, which is `neutral` when
  baselines drifted and `success` when they match (`neutral` does not block a merge). **Read
  `visual baselines`, not `visual`** — a drift once went unread for eight releases behind a green
  job. The baselines are CI's render, and a container's
  differs (`docs/KNOWN_LIMITATIONS.md`), so regenerate them from the pull request's `visual-diffs`
  artifact: unzip it (check its digest) and run `node scripts/refresh-visual-baselines.mjs <folder>`,
  which copies CI's render of each failed screenshot over its baseline. With no folder,
  `npm run test:visual:refresh` redraws the failed ones from this machine's render, which is for
  looking, not committing. Keep
  `-- --update-snapshots=all` for a deliberate sweep of drift inside the tolerance, then run
  `git status e2e/visual-baselines/` and revert anything you cannot explain. **The tolerance can
  hide a changed line of words** (a changed hint once moved 1,119 pixels against an allowance of
  1,152 — 0.1% at 1280×900). Words are
  the browser tests' to check, so when a hint or a label changes, redraw its screenshots from CI's
  render on purpose: CI writes a render only for a screenshot that fails or is missing, so take the
  stale baseline out, push, and commit what the next run draws.
- **`npm run test:visual:webkit`** — the same idea under Safari's engine, as a deliberately small set
  (config `playwright.visual-webkit.mjs`, baselines under `e2e/visual-baselines/webkit/` — a
  different engine's pixels, which will never equal their Chromium twins). Every Chromium baseline is
  Chromium's, so iOS BEHAVIOUR was far better proven than iOS APPEARANCE. **The mobile month grid is
  deliberately left out:** its fractional 390/7 columns are no more stable here than in Chromium, and
  a flaky baseline is worse than none, so the Calendar is represented by the day panel. Report-only
  in branch CI, for the same reason as the Chromium lane. It measured stable on a container (repeat
  runs green, a full regeneration byte-identical), which is why its tolerance is the Chromium lane's
  0.001 and not looser.
- **`npm run test:webkit`** — the smoke suite under Safari's engine, in branch CI. The deploy gate runs
  one file of it, `e2e/every-page.spec.js`, on the iPhone project (`docs/DECISIONS.md` → A few Safari
  tests gate the release). **The browser is not in a fresh dev
  container:** `npx playwright install webkit && npx playwright install-deps webkit`. The second step
  is apt, so it needs root; without it the launch dies listing missing shared objects, which reads
  like "unsupported". The standing "do not run playwright install" advice is about CHROMIUM, which IS
  pre-installed — it is not a ban on installing WebKit.
- **`npm run test:signed-in`** — the app's REAL Firebase SDK, signed in, against the Auth, Firestore
  and Functions emulators, under the real security rules and the real Cloud Functions, on both phone
  engines. Every other browser lane stubs the SDK and the rules suite tests the rules on their own, so
  this is the one place the app, the SDK, the rules and the server meet before production: a first
  sign-in and the forced password change, a day of leave saved, reloaded and drawn on the Calendar, a
  colleague's day refused, a manager recording on behalf, a save with no signal, a delete made just
  after the signal returns while that save is still queued, the same race in the Links workspace (a
  rename made while a design's offline save is still queued, as the designer), Back after signing out, and the sign-in audit's journeys: a real admin reset
  and the member's phone opened again, a token renewal refused mid-save, the silent surname re-sign-in,
  a disabled leaver, "Can't get in?", a new password from Settings, two tabs signing out, a browser
  restart (the member kept) and a new password whose record is still on its way
  (`e2e/signed-in.spec.js`). `scripts/signed-in.mjs` builds a
  throwaway Firebase project folder in the temp directory — the emulator settings from `firebase.json`,
  a placeholder for every secret the functions declare, never a real one — and writes nothing into
  the checkout. Each page keeps
  its own CSP, widened only by the emulators' addresses. **What it cannot see** is what only
  production has: the API key's allowed sites, the rules as DEPLOYED rather than as committed, Web
  Push, the service worker (blocked, so every request reaches the routes) and the Pages mirror. Nor
  a page brought back from the back/forward cache: Playwright launches Chrome with that cache off,
  so Back always loads afresh here. That guard is `page-session.test.mjs` and `e2e/auth.spec.js`,
  which send the restore event themselves.
  Branch CI runs both engines as the `signed-in` job. Both halves also gate the Hosting deploy, on the
  tree being released (`deploy-hosting.yml`): Android Chrome in its `signed-in` job, and the iPhone in
  its `safari` job. Behind a proxy, run
  `npx firebase setup:emulators:firestore` once first (the script's header says why).
- **`npm run test:live`** — the deployment health check in `CLAUDE.md`, run against the real site:
  both origins, the root and two sub-pages, asserting served, splash down, something usable and no
  console errors. Opt-in, and it gates nothing: the network and whatever is deployed right now are not
  properties of the branch under test. Run it after every deploying merge, once both Deploy Firebase
  Hosting and the Pages mirror's deploy that follows it have finished, and in a review. The mirror
  publishes only what that Hosting run released, a minute or two after it.
  **It prints its mode per page.** `DIRECT` is the full check;
  `RELAYED` means the browser could not complete TLS to the open internet, so each request was fetched
  with curl and fulfilled into the page — real bytes, real headers, real parsing, but the API-key
  HTTP-referrer restriction and a live Firebase round trip are NOT covered. Do not read a relayed pass
  as the whole check. It also runs on a schedule (`live-health.yml`, four-hourly on a GitHub runner)
  with `LIVE_REQUIRE_DIRECT=1`, so a run that would have to relay FAILS instead of passing weakly; a
  page still failing when the check looks again a minute later is reported on the `deploy-failure`
  issue thread, and one that has cleared by then is only noted on the run. The hourly
  `production-currency.yml` asks a different question — whether the served version matches `main` —
  which a stuck splash answers "yes" to.
- **`npm run test:mutation`** — `scripts/mutation-sweep.mjs`: every entry in
  `scripts/mutation-manifest.mjs` (a WIRING line on a path that moves money, decides access or names
  a person) broken in turn through `scripts/mutate.mjs`, with the narrowest Node suite that should
  notice run before and after. It fails when a mutant SURVIVES — a line no test would notice
  breaking — or gives no verdict. Weekly and non-blocking in `mutation.yml`, because a full run takes
  minutes and a survivor is a test to write, not a release to hold. It needs `npm ci` and `npm ci
  --prefix functions` and nothing else; a line only a browser can see is the browser lanes' work and is
  not listed. A STALE entry (its line edited away) does not wait for the schedule: `npm test` runs the
  sweep's `--check-only` (`mutation-sweep-script.test.mjs`), so re-aim the entry in the same commit.
- **`npm run test:offline`** — `e2e/offline.spec.js` under `playwright.offline.mjs`: the service
  worker's offline-first paths with the network cut. Not in `npm test` or any gate; it runs weekly,
  non-blocking, in `offline.yml`.

**Run one Playwright lane at a time, and do not switch branches under one.** The suites share a dev
server and `test-results/`, so a concurrent run reads false reds and a branch switch invalidates the
run.

**A local browser run tests only this checkout.** Each checkout's dev-server port comes from its path,
and two checkouts can land on the same one, so before the first test a run checks that the server it
found serves this checkout's files, and stops if not (`e2e/server-identity.mjs`).
`E2E_DEV_PORT=<port>` pins this checkout to another port.

## Where to read next

| Document | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | **the index** — which document is authoritative for each subject, and where what is deployed differs from what is documented. Start here |
| `CLAUDE.md` | the working manual: architecture decisions, conventions, change impact (the file catalogue is `docs/FILE_INDEX.md`, the data model `docs/DATA_MODEL.md`) |
| `docs/AI_MAP.md` | every module and its exports |
| `docs/OPERATIONS_REFERENCE.md` | how the app is run day to day |
| `docs/KNOWN_LIMITATIONS.md` | what is wrong or deferred, and why |
| `docs/RECOVERY_RUNBOOK.md` | backup, rollback and incident playbooks |

Feature behaviour is stated as numbered invariants in `docs/CALENDAR_DATA.md`, `docs/AUTH_AND_SESSIONS.md`,
`docs/OVERTIME_AVAILABILITY.md` and the rule files under `.claude/rules/`. Design reasoning lives in each
module's own header, next to the code it constrains, rather than being copied into these documents.
