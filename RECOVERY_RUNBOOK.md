# RECOVERY_RUNBOOK.md

*Backup, rollback and disaster-recovery procedures for the MYB Roster app.
Not version-stamped; not a runtime asset. Owner-facing operational doc.*

---

## What this is (read first)

The app now holds real operational records (rostered shifts, annual leave, absence,
link designs, uploaded documents). This runbook is the "break glass" guide: how to get
data or the live site back when something goes wrong — a wrong roster upload, a deleted
override, a bad deploy, or a Firebase outage.

**Two kinds of section:**

1. **Set up once, in advance** (the "Before you need it" block) — the backups and safety
   nets that only help if they were switched on *before* the incident. Do these now.
2. **Incident playbooks** — task-led, one per failure. Find your symptom, follow the steps.

**Plain-language note (for the owner):** every command below runs against the live
Firebase project `myb-roster` (region `europe-west2`, London). Commands that only *read*
or *export* are safe to rehearse. Commands that *import*, *restore*, *delete* or *deploy*
change live data or the live site — read the whole step before running one, and never
run an `import`/`restore` into the live database without understanding that it can
**overwrite** current documents.

**The golden rule:** the fastest recovery is almost always a **rollback** (Rules, Hosting,
Functions all keep previous versions you can revert to in seconds) or a **manual re-entry**
of a single record — *not* a full database restore. Reach for a full restore last.

---

## Project facts (where everything lives)

| Thing | Value |
|-------|-------|
| Firebase project ID | `myb-roster` |
| Region | `europe-west2` (London) |
| Firestore database | `(default)` |
| Firestore collections | `overrides`, `huddles`, `circulars`, `newsletters`, `staffContact`, `passwordStatus`, `pushSubscriptions`, `clientErrors`, `analytics`, `linkDesigns`, `linkTargetSets`, `resetRequests`, `viewerAttempts`, `overtimeWindows` (a TREE — `participants`/`submissions`/`revisions` subcollections; an export that takes the parent alone restores an empty week). **The four after `linkDesigns` were missing from this row until v21.63**, which meant a backup scoped from it omitted the whole Overtime feature and the locked-out-member queue. The authority is `firestore.rules` — every top-level `match` is a collection to scope |
| Storage paths | `huddles/…`, `circulars/…`, `newsletters/…` |
| Cloud Functions (europe-west2) | **Do not keep a second list here.** `functions-surface.test.mjs` pins the whole deploy surface in CI and is the only copy that cannot fall behind — read it. (This row named 8 of the 18 until v21.63; playbook E was written against that short list, so a rollback scoped from it would have missed every Overtime endpoint, the PIN exchange and the reset queue.) |
| Live site (primary) | `https://myb-roster.web.app` (Firebase Hosting) |
| Live site (mirror) | `https://garethdavidmiller.github.io/roster-app/` (GitHub Pages, built from `main`) |
| Deploy mechanism | GitHub Actions via Workload Identity Federation → `github-deploy@myb-roster.iam.gserviceaccount.com`. Workflows: `deploy-functions.yml`, `deploy-hosting.yml`, `deploy-rules.yml` |
| Source of truth for a rollback | this git repo — `main` is what deploys |
| **IAM prerequisite for `unlockCalendarViewer`** | The Cloud Run runtime service account — currently `532910998075-compute@developer.gserviceaccount.com` — must hold **`roles/iam.serviceAccountTokenCreator` on itself**, and `iamcredentials.googleapis.com` must be enabled. Under Application Default Credentials `createCustomToken` cannot sign locally; it calls the IAM Credentials API. **Gen-2 does not grant this by default and nothing in the repo can enforce it** — its absence caused the 10 Aug 2026 outage, in which every correct PIN returned 500 while every wrong one returned a healthy 401. Re-apply it if the runtime service account changes, if the function is given its own service account, or if the project is rebuilt. |

You need the **Firebase CLI** (`npm i -g firebase-tools`, then `firebase login`) and the
**gcloud CLI** (`gcloud auth login`, `gcloud config set project myb-roster`) on your own
machine for the CLI paths below. Most rollbacks can also be done from the **Firebase
Console** with no CLI at all — those are called out because they're the fastest.

> CLI flags drift between tool versions. Where a command is shown, treat it as the shape
> of the command and confirm the exact flags against `gcloud firestore --help` /
> `firebase --help` before running it live.

---

## Before you need it — set these up now

These are the difference between "restored in minutes" and "gone". None exist by default.

### 1. Turn on Firestore Point-in-Time Recovery (PITR) — do this first

PITR lets you read the database *as it was* at any minute within the last **7 days**. It is
the single biggest safety net for "someone deleted/overwrote a record an hour ago", and it
costs almost nothing for a database this size.

- Console: **Firestore → Backups** (or the database settings) → enable **Point-in-time recovery**.
- CLI:
  ```
  gcloud firestore databases update --database='(default)' --project=myb-roster
  # (confirm the current flag name for enabling PITR in your gcloud version)
  ```

Once on, you can export a snapshot from any moment in the window (see "Restore from an
export" below, `--snapshot-time`).

### 2. Turn on scheduled Firestore backups

Firestore's **managed backups** run on a schedule and keep restorable copies (retention up
to 14 weeks). Separate from PITR; survives longer.

```
gcloud firestore backups schedules create \
  --database='(default)' --project=myb-roster \
  --recurrence=weekly --retention=14w
```

Restores go to a **new** database (you can't overwrite `(default)` from a backup) — see the
restore section. List/inspect with `gcloud firestore backups list`.

### 3. Keep a portable weekly export in Cloud Storage

Native backups live inside Firestore. A plain **export to a GCS bucket** is a portable copy
you fully own and can inspect or import selectively.

- Create a bucket once (same region): `gsutil mb -l europe-west2 gs://myb-roster-backups`
- Manual export (safe, non-destructive — rehearse this one):
  ```
  gcloud firestore export gs://myb-roster-backups/$(date +%F) --project=myb-roster
  ```
- To automate: a Cloud Scheduler job hitting the export API weekly, or just run the manual
  command on a calendar reminder. For this team, a **weekly manual export** is enough.

### 4. Know the git rollback points

Everything that deploys comes from `main`. For any bad deploy, the recovery is "get `main`
back to the last-known-good commit and let the workflow redeploy", or use the platform's
own version history (Rules/Hosting/Functions all keep one). Keep the repo cloned locally so
you can `git revert` in an emergency.

### 5. Rehearse once

Do these three safe things once so they're not new under pressure:
- Run a manual Firestore export (#3) and confirm files appear in the bucket.
- Open **Firebase Console → Hosting → release history** and find the "Rollback" control.
- Open **Firestore → Rules → history** and find the rollback control.

---

## Incident playbooks

### A. A shift / annual-leave / absence override was deleted or set wrong

**Symptom:** a day shows the wrong shift, or a booked leave/absence vanished.

1. **If you know what it should be — just re-enter it.** This is the normal, fastest fix:
   Admin → **Change a Shift** (or the AL / Absence card) → set the correct value → save.
   Overrides are one document per member+date (Firestore auto-generated IDs — the
   `memberName|YYYY-MM-DD` string is only the client cache key); re-creating one is a
   normal save, not a "restore".
2. **If you don't know the old value and PITR is on**, export a snapshot from before the
   change and read it:
   ```
   gcloud firestore export gs://myb-roster-backups/pitr-snap \
     --snapshot-time=2026-07-11T09:00:00Z --project=myb-roster
   ```
   Inspect that export (or import it into a throwaway database) to read the old `value`,
   then re-enter it via Admin as in step 1.
3. **Never** import a whole snapshot back into the live database to fix one override — it
   would overwrite everyone else's newer changes.

### B. A bad roster PDF was uploaded

**Good news — this one mostly self-heals.** Roster-upload overrides are written with
`source: 'roster_import'`, and re-uploading the correct roster for the same week
**removes the stale imported overrides and re-applies the corrected ones**. Manual changes
(`source: 'manual'`) are preserved and surface as conflicts for you to choose.

1. Re-upload the **correct** PDF for the same week via Operations → Weekly Roster Upload.
2. Review the table: MATCH rows are already right; DIFF/CONFLICT rows let you keep the
   correct value. Save.
3. If a wrong value was already *manually* re-saved on top, fix that day via **Change a
   Shift** (playbook A).
4. Only if the correct source PDF is unavailable *and* PITR is on: export a pre-upload
   snapshot (playbook A step 2) to read the affected days, then re-enter them.

### C. A Link Design was lost or corrupted

**Symptom:** a design in the Links workspace is gone or scrambled.

- `linkDesigns` docs are `{ name, patterns, window, updatedAt, updatedBy }` — the shape is
  `docPayload` in `links-design-doc.js`, which exists precisely so nobody hand-builds a sixth copy
  of it. **`window` is load-bearing and this playbook omitted it until v21.63.** A design restored
  without its window comes back wearing the app default, the heat map then measures its gaps
  against a span nobody chose, and the next save writes that default over the moved boundary the
  design was built to test — which is the v19.55 bug, reintroduced by the recovery procedure.
- **Regenerate:** the auto-generator can rebuild a full rotation from scratch — often faster than
  restoring. (Do not write the line count down here; `ROTATING_LINES` owns it.)
- **Restore the old content:** with PITR on, export a pre-corruption snapshot and restore
  **`patterns` AND `window` together**, then paste back by editing the design (or re-create the doc).
- Low urgency: Links is a design workspace used by the members of `CONFIG.LINKS_DESIGNERS`, not a
  staff-facing record.

### D. A Circular / Newsletter / Huddle won't open or has the wrong metadata

Each document is a Firestore doc (`circulars/{date}` etc.) **plus** a Storage file.

1. **File is fine, metadata wrong (wrong date, "Latest" showing the wrong one):**
   re-upload the file for the correct date via Operations — the upsert overwrites the doc.
2. **Storage file missing but Firestore doc points at it (or vice-versa):** re-upload the
   original file; the upload writes both sides fresh.
3. **Auto-prune caught up with it:** Huddles keep **3 months**, Circulars/Newsletters keep
   **6 months**, then both the doc and the file are deleted on purpose. That's not a fault —
   re-upload if it's still needed.
4. A DOCX that downloads instead of opening is expected on some setups; for reliability,
   prefer **PDF** uploads for Circulars/Newsletters (documented trade-off — Word opens via
   Microsoft's Office Online viewer).

### E. A Cloud Functions deploy broke something

**Symptom:** Huddle ingest, roster parsing, or account setup stops working after a deploy.

1. **Revert the commit and let the workflow redeploy** (matches the normal WIF/Actions flow):
   ```
   git revert <bad-commit-sha>
   git push origin main        # triggers deploy-functions.yml
   ```
   Watch the Actions run to green.
2. **Emergency local redeploy** (if Actions itself is the problem), from a good checkout:
   ```
   firebase deploy --only functions --project myb-roster
   ```
3. Check function logs to confirm recovery: **Console → Functions → Logs**, or
   `firebase functions:log`.
4. Secrets (`HUDDLE_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_*`) live in Firebase Secret
   Manager — a deploy doesn't wipe them; a broken function is almost always code, not secrets.

### F. A Firestore / Storage Rules deploy locked people out (or opened access)

Rules are the security boundary — a bad rules change can silently break every write, or
over-expose data. This is the **fastest** thing to roll back.

1. **Console rollback (seconds, no deploy):** **Firestore → Rules → (version history)** →
   pick the last-good version → **Rollback**. Same for **Storage → Rules**.
2. **Or revert in git** (goes through the gated pipeline):
   ```
   git revert <bad-commit-sha>
   git push origin main        # triggers deploy-rules.yml (rules tests gate it)
   ```
3. Re-run `npm run test:rules` locally before any forward fix — the rules test suite is the
   safety net that should have caught it.
4. **Auth silently failing everywhere but rules look fine?** Check the **API key referrer
   allowlist** (GCP Console → APIs & Services → Credentials) — a missing domain makes every
   Firebase Auth call fail with no visible error. It must include `myb-roster.web.app/*`,
   `myb-roster.firebaseapp.com/*`, and `garethdavidmiller.github.io/*`.

### G. A Hosting deploy broke the live site (blank page, CSP error, 404)

**Remember the trap:** your own installed phone loads from its service-worker cache and will
look fine **even when the live site is completely broken**. Always verify in a **fresh
private window** (no cache, no SW): does `https://myb-roster.web.app` load *past* the splash
to the calendar, with no red console errors?

1. **Hosting rollback (fastest):** **Console → Hosting → release history → Rollback** to the
   previous release. (There is **no `firebase hosting:rollback` CLI command** — the Console
   button is the rollback path. The nearest CLI equivalent is `firebase hosting:clone` from a
   known-good preview channel, which only helps if one exists.)
2. **Or revert the commit** and let `deploy-hosting.yml` redeploy.
3. After recovery, re-check the deployment health list in `CLAUDE.md` (the live-URL checks),
   especially if the change touched `firebase.json` (CSP/headers) or the Firebase SDK version.

### H. The live site is broken by Hosting infra, not app code → use the GitHub mirror

The mirror at `https://garethdavidmiller.github.io/roster-app/` is served by **GitHub Pages**
from `main`, completely independent of Firebase Hosting.

- **It helps when the problem is Firebase *Hosting infrastructure*** (a bad hosting config,
  a Hosting outage) — direct staff to the mirror URL (note the `/roster-app/` path; the bare
  origin 404s).
- **It does *not* help for an app-code bug** — the mirror is built from the same `main`, so
  it has the same bug. For code bugs, fix/roll back the code (playbook G).
- New installs from the mirror rely on `garethdavidmiller.github.io/*` being in the API-key
  referrer allowlist (it is — keep it there).

### I. Firebase / Google Cloud is having an outage

**Symptom:** everything is failing at once, across accounts, not tied to any deploy.

1. **Confirm it's them, not you:** check `https://status.firebase.google.com` and
   `https://status.cloud.google.com`.
2. **What still works:** the app is offline-first. Installed PWAs keep showing **cached**
   roster data; Firestore writes fail into the app's silent fallbacks (no data loss, they
   just don't persist until service returns). Reads of already-cached months keep working.
3. **What to tell staff:** "The roster app can't load new changes right now due to a Google
   service issue — your existing schedule still shows. Try again shortly." Nothing to fix on
   our side; do not redeploy or change rules chasing an outage.
4. When service returns, spot-check a write (save a test override and confirm it sticks) and
   re-run the deployment health checks.

---

## Restore from an export or backup (the last resort)

Use only when a record genuinely can't be re-entered by hand and PITR-read isn't enough.

- **Managed backup → restore to a NEW database, then copy across:**
  ```
  gcloud firestore databases restore \
    --source-backup=<backup-name> \
    --destination-database=roster-restore --project=myb-roster
  ```
  Read the recovered docs from `roster-restore` and re-create the specific ones you need in
  `(default)`. You cannot restore directly over `(default)`.

- **GCS export → import (DANGEROUS on the live DB):**
  ```
  gcloud firestore import gs://myb-roster-backups/<path> --project=myb-roster
  ```
  Import **overwrites** documents with matching IDs from the export and does **not** delete
  newer docs — so a whole-collection import rolls those documents back in time and can undo
  everyone's changes since the snapshot. Prefer importing into a **separate database** first,
  inspecting, and copying only the needed records.

**Rule of thumb:** restore *one record by hand* over restoring *a collection*, and restore a
*collection into a scratch database* over importing over the live one.

---

## Quick reference

| Symptom | First action | Where |
|---------|-------------|-------|
| One shift/AL/absence wrong or deleted | Re-enter it | Admin → Change a Shift |
| Bad roster upload | Re-upload correct PDF (self-heals imports) | Operations → Weekly Roster Upload |
| Link design lost | Regenerate, or read old `patterns` from a PITR snapshot | Links workspace |
| Doc won't open / wrong date | Re-upload for the correct date | Operations |
| Bad Functions deploy | `git revert` + push, or `firebase deploy --only functions` | git / CLI |
| Bad Rules deploy | Console → Rules → Rollback (seconds) | Firebase Console |
| Broken live site | Console → Hosting → Rollback | Firebase Console |
| Hosting infra down | Point staff at the `/roster-app/` GitHub mirror | — |
| Everything failing at once | Check status pages; wait; don't redeploy | status.firebase.google.com |
| Auth silently failing | Check API-key referrer allowlist | GCP → Credentials |
| Genuine data loss | PITR snapshot export → read → re-enter by hand | gcloud |

---

## Related docs

- `CLAUDE.md` — project identity, deployment health checks, API-key referrer allowlist,
  collection shapes.
- `OPERATIONS_REFERENCE.md` — Huddle/roster ingest flow and Security Rules detail.
- `SECURITY_RELEASE_PLAN.md` — WIF deploy identity, claim model, the deferred security work.
- `KNOWN_LIMITATIONS.md` — "The installed PWA masks live-site breakage" (why you must verify
  in a fresh window).

---

## The Calendar PIN — deployment order, and breaking glass

### Deploying it (the order is the whole safety story)

**Never deploy the rules first.** The old client signs in anonymously and reads `overrides`
directly; tightening the rule ahead of the client that can satisfy it means every staff phone shows
the base roster with a "Couldn't update" chip — a roster that is *wrong*, not obviously broken.

**That ordering has to be made by hand, because the three deploy workflows do not provide it.**
`deploy-functions.yml`, `deploy-hosting.yml` and `deploy-rules.yml` all fire from the same push to
`main`, in parallel, with no sequencing between them — so a single merge carrying the function, the
client and the rules performs steps 2, 3 and 4 *simultaneously*, and whether the rules land before
or after the hosting deploy is a coin toss. The branch therefore ships with two brakes on, and the
steps below are three separate pushes rather than one:

| Brake | Where | Ships as | Released at |
|---|---|---|---|
| `CONFIG.CALENDAR_PIN_ACCESS` | `roster-data.js` | **RELEASED — `true` and live since v20.51.** (It shipped `false`, was released at v20.46, rolled back at v20.50 the same morning, and re-released at v20.51 once the cause was found to be a GCP IAM gap rather than app code. This row said "ships as `false` … ROLLED BACK" until v21.63, which read as though the soak had never restarted — an argument for postponing step 4 on false grounds.) | step 3 — **DONE** (soaked from v20.51); the whole sequence closed at step 4 on 26 Aug 2026 |
| `allow read;` hold line | `firestore.rules` overrides block | **RELEASED — deleted 26 Aug 2026 (v21.78).** `overrides` reads now require a `name` claim, `admin`, or the `calendarViewer` capability; a request with none is refused by the SERVER | step 4 — **DONE** |

The hold line was declared a second time as `OVERRIDES_READ_HELD_OPEN` in `firestore.rules.test.mjs`,
and `calendar-viewer-parity.test.mjs` fails if the two disagree in either direction. That is what
stopped the hold outliving the rollout: it could not be forgotten quietly, only removed deliberately.
**Both brakes are now off. The rollback is no longer a flag flip** — it is reverting the step-4 rules
push and redeploying, which is a two-minute path but a different one, and every step below is kept
as the record of how the release ran rather than as work still to do.

1. **Secret — BEFORE the merge, not after.** `firebase functions:secrets:set CALENDAR_VIEWER_PIN`.
   This is not merely "nothing works without it": `firebase deploy --only functions` resolves the
   `latest` version of every secret bound to a deploying endpoint (`validateSecretVersions` in
   firebase-tools) and throws if one has no version. `defineSecret` creating the container is not
   enough — an empty secret still fails. And the check covers the WHOLE deploy, so an unset PIN does
   not fail just `unlockCalendarViewer`; it fails `ingestHuddle`, `parseRosterPDF` and everything
   else in the same run. The live functions keep serving their current revision, so nothing breaks
   for staff, but the push ships no function code and opens a deploy-failure issue. Recoverable —
   set the secret and re-run the workflow — but the cheap move is to set it first.
2. **Merge the branch, and the function goes live with it.** Prove `unlockCalendarViewer` from the
   production origin. Both brakes are still on, so staff see no change whatsoever — this is the dark
   deploy, and its job is to prove the *rest* of the release (session handling, the nav drawer, the
   calendar bootstrap) against real devices while the feature itself is invisible.
2b. **Prove the SUCCESS path in production, by hand, BEFORE step 3.** ✅ Passed 10 Aug 2026, on the
   second attempt — the first found the IAM gap in the project-facts table above, which is exactly
   what this step exists to catch. Someone holding the PIN opens
   the live Calendar in a private window and unlocks it. That is the whole check, and there is no
   automated substitute: it is the only way the token mint is exercised against real IAM, real Auth
   and the real secret. If it fails, read the function log — `[unlockCalendarViewer] token mint
   failed <code> <message>` names the cause. The known candidate is an IAM gap: `initializeApp()`
   uses ADC, so `createCustomToken` signs through the IAM Credentials API and needs the Cloud Run
   runtime service account to hold `roles/iam.serviceAccountTokenCreator` **on itself**, which gen-2
   does not grant by default.
3. **Client.** Set `CALENDAR_PIN_ACCESS: true` and push — hosting only, one line, no rules change.
   The Calendar now asks for the PIN and mints a viewer session, and because the rule is still
   permissive a stale cached client keeps working. **Let this soak.** Rolling back is the same one
   line, and while the rules are still permissive that rollback genuinely re-opens the Calendar.
   *(Both conditions in that last sentence expired at step 4 on 26 Aug 2026. `CALENDAR_PIN_ACCESS:
   false` is no longer a rollback — see step 4.)*

   > **⛔ DO STEP 2b FIRST — this step failed on 10 Aug 2026 and had to be reverted within hours.**
   > A correct PIN returned 500 from the function's token-mint block; every member entering the right
   > code got "Calendar couldn't be unlocked" and no roster. The rollback itself worked perfectly (one
   > line, ~4 minutes), which is the only reason it was cheap. What did not work was the verification:
   > step 2 had been signed off on `GET` → 405 and a WRONG PIN → 401, and **neither of those touches
   > the minting path** — `getUser`/`createUser`, `setCustomUserClaims` and `createCustomToken` run
   > only for a CORRECT PIN. So the part of the endpoint that actually does something had never run
   > in production. The e2e suite stubs the exchange (rightly — a test must not hold the secret), so
   > nothing in CI covers it either.

4. **Rules.** Remove the `allow read;` hold line and set `OVERRIDES_READ_HELD_OPEN = false` in the
   same commit; push with nothing else in it. From this moment an old cached client cannot read
   overrides — and from this moment `CALENDAR_PIN_ACCESS: false` is **no longer a rollback**, because
   the reads are denied by the server whatever the client asks for. After step 4 the rollback is
   step 4's own revert.

   > **DONE — 26 Aug 2026** (scheduled for Mon 24 Aug; shipped two days later). The go/no-go was
   > taken on the pre-flight below: the App Speed version breakdown showed most real loads had moved
   > off the pre-v20.51 client, and page views were broadly level with July. `deploy-rules.yml`
   > succeeded at 16:38, and step 5 confirmed it in production the following morning — so the
   > whole sequence is closed.
   >
   > **Two things the pre-flight asked for that the Operations cards cannot actually produce**, and
   > which cost time on the day: item 1 wants the share of loads on a pre-v20.51 client, but the App
   > Speed card aggregates the WHOLE MONTH, so early-August loads on old versions are counted for
   > ever and the figure is systematically pessimistic about how stale devices are TODAY. Item 2
   > wants calendar page views over a 7-day window against a pre-10-Aug baseline, but page
   > popularity is stored per MONTH (`analytics/pv_<YYYY-MM>`) with no daily bucket — only the
   > active-account counter has one. Both were answered by proxy: "most have moved off", and
   > "overall views broadly level with July", which detects the failure mode (a collapse in opens)
   > even though it is not the window as written. If this sequence is ever run again, either add a
   > daily page-view bucket first or write the pre-flight against what the cards actually hold.
   >
   > **What the soak is actually for, and it is not what it sounds like.** It is not about proving
   > the PIN works — that was step 2b, by hand, on 10 Aug. It is about *how many devices are still
   > running a client that reads overrides ANONYMOUSLY*, because those are the ones this step breaks
   > for one load. Every day converts more of them, and only opening the app converts one.
   >
   > **The cutover version is v20.51, NOT v20.46** (corrected v21.63). v20.46 released the flag and
   > **v20.50 turned it back off**, so a device sitting on v20.46–v20.50 is in the at-risk population
   > exactly like a pre-v20.46 one. Reading it as "pre-v20.46" undercounts the devices this step
   > breaks, which is the wrong direction for a go/no-go number to be wrong in.
   >
   > **Pre-flight, in this order:**
   > 1. **Operations → App Speed → "Why some are slower" → by version.** The share of real loads
   >    still on a **pre-v20.51** client. This is the number that decides go/no-go; a trickle is fine.
   >    (Versions roll up into ranges, so BOTH `v20.40–v20.49` and `v20.50–v20.59` straddle the
   >    cutover. Neither settles it alone — treat the whole of the first as at-risk, and read the
   >    second as mostly-converted but not provably so.)
   > 2. **Operations → Usage → calendar page views**, last 7 days vs. the same window before 10 Aug.
   >    A successful unlock records usage and a failed one records nothing, so a material drop means
   >    unlocks are failing. **This is the only soak signal there is** — a locked Calendar has no
   >    identity, so a failing PIN exchange never reaches the Error Log. Silence there is not health.
   > 3. `unlockCalendarViewer` in the Functions log, for outright errors.
   > 4. The rules deploy path is green — proven 14 Aug (`f51400f`) after a transient failure the day
   >    before. Do not ship step 4 on top of a red rules workflow.
   >
   > **Be free to postpone.** The exposure this closes has stood for years and another fortnight
   > costs little; getting a roster wrong for somebody on their first shift back costs more.
5. **Verify in production**, in a fresh private window: PIN → roster → reload → still unlocked →
   Team View → month navigation → Admin (must demand a member sign-in) → close the browser →
   PIN again. Then on a phone, and at an office-desktop width.

   > **DONE — 27 Aug 2026**, confirmed by the owner. This is the step nothing automated can stand in
   > for: the e2e suite stubs the exchange (rightly — a test must not hold the secret), so the mint
   > path is only ever exercised for real by a person entering the real PIN against the real
   > function. That is exactly the gap that let the 10 Aug attempt ship a 500 (see step 3's warning),
   > and it is why this step is a person and not a job.
   >
   > **The sequence is now CLOSED end to end.** `CALENDAR_PIN_ACCESS: false` is not a rollback any
   > more — reverting step 4's rules commit is.

**The mixed-version window at step 4** is one page load wide: the service worker claims immediately
on activate and reloads the page, so a device is on the new client by its next open. Within that one
load an old client shows the base roster plus the sync chip's "Couldn't update — tap to retry". That
is visible and recoverable, and step 3's soak is what keeps the window to a single load rather than
a deploy cycle.

### If viewer authentication fails in production

**Restore availability first.** An unreadable Calendar is obvious; a Calendar quietly showing the
base roster without overrides shows somebody a shift they are not working, and they will act on it.

1. In `firestore.rules`, replace the `overrides` read rule with `allow read;` and deploy rules.
   The Calendar is public again and correct again. Say so to staff — it is a real, if temporary,
   loss of the protection.
2. Diagnose from the Cloud Function logs (`unlockCalendarViewer`). A locked Calendar has no Firebase
   identity, so **nothing appears in the Operations Error Log** — do not read its silence as health.
   The usual causes are an unset or un-redeployed secret (`503`, or every PIN rejected) and a
   claim/uid mismatch between the function and the rules (unlock succeeds, no shifts appear).
3. Fix, redeploy the function, confirm from a fresh private window, then re-tighten the rule.

Do **not** leave it half-working: a Calendar that renders without its overrides is the one outcome
worse than a Calendar that will not open.

### If the PIN gets out

Rotation needs no client release — OPERATIONS_REFERENCE.md → "Rotating the Calendar PIN". Set the new
secret, redeploy the function, tell staff. Existing unlocked sessions keep working until their
browsers close; to kill those too, revoke the shared account's refresh tokens
(`getAuth().revokeRefreshTokens('calendar-viewer')`, from `firebase-admin/auth`). Member sessions are untouched either way.
