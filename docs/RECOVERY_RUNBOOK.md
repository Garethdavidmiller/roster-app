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
| Firestore collections | `overrides`, `huddles`, `circulars`, `newsletters`, `staffContact`, `passwordStatus`, `pushSubscriptions`, `clientErrors`, `analytics`, `linkDesigns`, `linkTargetSets`, `resetRequests`, `viewerAttempts`, `overtimeWindows` (a TREE — `participants`/`submissions`/`revisions` subcollections; an export that takes the parent alone restores an empty week). **The authority is `firestore.rules`** — every top-level `match` is a collection to scope, so check this row against it before scoping a backup from it: a backup scoped from a short list silently omits whole features |
| Storage paths | `huddles/…`, `circulars/…`, `newsletters/…` |
| Cloud Functions (europe-west2) | **Do not keep a second list here.** `functions-surface.test.mjs` pins the whole deploy surface in CI and is the only copy that cannot fall behind — read it. A rollback scoped from a hand-kept list misses whatever the list forgot. While Overtime is paused its five endpoints and daily creator are not exported (`OVERTIME_AVAILABILITY.md` → Paused) |
| Live site (primary) | `https://myb-roster.web.app` (Firebase Hosting) |
| Live site (mirror) | `https://garethdavidmiller.github.io/roster-app/` (GitHub Pages, built from `main`) |
| Deploy mechanism | GitHub Actions via Workload Identity Federation → `github-deploy@myb-roster.iam.gserviceaccount.com`. Workflows: `deploy-functions.yml`, `deploy-hosting.yml`, `deploy-rules.yml`, and `deploy-mirror.yml` (the Pages mirror, once its source is switched to GitHub Actions) |
| Source of truth for a rollback | this git repo — `main` is what deploys |
| **IAM prerequisite for `unlockCalendarViewer` (and `getDocumentUrl`)** | The Cloud Run runtime service account — currently `532910998075-compute@developer.gserviceaccount.com` — must hold **`roles/iam.serviceAccountTokenCreator` on itself**, and `iamcredentials.googleapis.com` must be enabled. Under Application Default Credentials `createCustomToken` cannot sign locally; it calls the IAM Credentials API. **Gen-2 does not grant this by default and nothing in the repo can enforce it** — its absence caused the 10 Aug 2026 outage, in which every correct PIN returned 500 while every wrong one returned a healthy 401. Re-apply it if the runtime service account changes, if the function is given its own service account, or if the project is rebuilt (the command is §5b below). |

You need the **Firebase CLI** (`npm i -g firebase-tools`, then `firebase login`) and the
**gcloud CLI** (`gcloud auth login`, `gcloud config set project myb-roster`) on your own
machine for the CLI paths below. Most rollbacks can also be done from the **Firebase
Console** with no CLI at all — those are called out because they're the fastest.

> CLI flags drift between tool versions. Where a command is shown, treat it as the shape
> of the command and confirm the exact flags against `gcloud firestore --help` /
> `firebase --help` before running it live.

---

## Before you need it — set these up now

These are the difference between "restored in minutes" and "gone". None exist by default —
**and on THIS project two of the three are ON, verified 19 Sep 2026:**

```
Schedules: present · PITR: present
```

So the restore procedures below are **executable rather than aspirational**, and the conditional
wording that runs through this file — *"if PITR is on"*, *"with PITR on"* — resolves to YES.

**Whether they stay on is ASKED weekly, not remembered** —
`.github/workflows/backup-check.yml` lists the backup schedules and reads the PITR setting on a
schedule and on demand (`workflow_dispatch`), and opens/comments on the `deploy-failure` thread when
BOTH are definitely absent. It is READ-ONLY and never turns anything on: that has a cost attached
and is the owner's call. An "unknown" (the account it runs as may not hold
`datastore.backupSchedules.list`) is reported as an unknown, never as an absence.

**STILL NOT DONE, and it is the honest caveat on all of the above: nobody has ever tested a
RESTORE.** A backup that has not been restored from is a belief, not a capability. The path below
lands in a NEW database — `(default)` cannot be overwritten from a backup — and that has never been
exercised here. Section 3's portable GCS export is also still not set up.

### 1. Point-in-Time Recovery (PITR) — **ON since 19 Sep 2026**

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

### 2. Scheduled Firestore backups — **ON since 19 Sep 2026**

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

### 5b. The document-signing grant — one command, and nothing works without it

`getDocumentUrl` hands staff a 15-minute URL for the Huddle, Circular or Newsletter instead of the
permanent one. Signing requires the runtime service account to be able to sign AS ITSELF:

```
gcloud iam service-accounts add-iam-policy-binding \
  532910998075-compute@developer.gserviceaccount.com \
  --member="serviceAccount:532910998075-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" --project=myb-roster
```

That is the runtime service account named in the table at the top — the default Compute account, not
an `@myb-roster.iam` one — and it is the SAME grant as the `unlockCalendarViewer` IAM prerequisite
there, so if the PIN works the grant is already in place.

**Without it the endpoint answers 503 on every call.** That is deliberate and safe: the client
treats 503 as "use the stored URL", so a missing grant degrades to the OLD behaviour rather than to
a broken button. The symptom is therefore silent — documents keep opening on permanent URLs and
nobody notices the change never took effect. Check the Functions log for
`signing failed — is serviceAccountTokenCreator granted?` after deploying.

### 6. The RESTORE DRILL — the one rehearsal that is not on the safe list

**A backup nobody has restored from is a belief, not a capability.** PITR and a managed schedule
went on 19 Sep 2026 and a run confirmed both; what has never been done, here or anywhere in this
project's life, is the sequence that actually matters — *backup → restore → verify → cut over*.
Two external reviews have now named it as the largest remaining reliability gap, ahead of adding
any further backup mechanism.

It is deliberately NOT in the three-item list above, because unlike those it **costs money and
creates a second live database**. Read the whole of this before starting, and do it on a quiet day.

**Prerequisites — check these first, because the drill stops dead without them.**

- The caller needs `datastore.backups.list` and `datastore.databases.restore` on the project. The
  deploy service account `github-deploy@myb-roster.iam.gserviceaccount.com` is **not known to hold
  the restore permission** — it was scoped for deploys — so expect to run this as the owner, not
  through CI, and grant the role explicitly if you want it automated later.
- There is no standing GCP credential outside GitHub Actions (`SECURITY_RELEASE_PLAN.md` → A2), so
  an agent session cannot do this for you. That is by design.

**The drill.**

1. **List what exists.** Nothing below is worth doing if this comes back empty.
   ```
   gcloud firestore backups list --project=myb-roster
   ```
   Note a backup's full name and the time it was taken. That time is your expectation for step 4.

2. **Restore into a scratch database.** Never over `(default)` — it cannot be done, and the attempt
   is the most dangerous thing on this page.
   ```
   gcloud firestore databases restore \
     --source-backup=<backup-name> \
     --destination-database=drill-$(date +%Y%m%d) --project=myb-roster
   ```
   It is asynchronous. `gcloud firestore operations list --project=myb-roster` shows progress.

3. **Time it, and write the number down.** How long the restore took is the single most useful
   figure this drill produces: it is what you would be telling people on the day.

4. **Verify — and verify the thing a restore can silently get wrong.** Not "does the database
   exist" but "is the DATA the data". Read from the scratch database, never the live one:
   - `overrides` — the collection that holds every shift change, absence and booked leave. Pick a
     member and a month you can check against the live app, and confirm the documents match.
   - `overtimeWindows` — frozen participant lists; a window's population must not have changed.
   - `linkDesigns` — the workspace's own revision fields should be intact, not reset.
   - `staffContact` — present, and still readable only under the rules you expect.
   - The backup's timestamp from step 1: anything written AFTER it must be **absent**. A restore
     that appears to contain today's data is not a restore, and finding that out here is the point.

5. **Practise the cutover you would actually perform**, on one document. The runbook's standing
   advice is to restore *one record by hand* over a whole collection: copy a single `overrides`
   document from the scratch database into `(default)` and confirm the app renders it. That is the
   step nobody has walked, and it is where a surprise would live.

6. **DELETE THE SCRATCH DATABASE.** It bills for storage until you do, and a stale `drill-*`
   database is a second copy of everyone's data sitting where nothing is watching it.
   ```
   gcloud firestore databases delete --database=drill-<date> --project=myb-roster
   ```

7. **Record the date and the restore time** in `MAINTENANCE_CALENDAR.md`, and update
   `KNOWN_LIMITATIONS.md` → *"No restore has ever been TESTED"*, which is the entry this closes.

**What the drill does NOT prove.** It exercises the managed-backup path only. PITR is a different
mechanism, section 3's portable GCS export still does not exist, and neither is covered by doing
this. It also says nothing about how long a FULL restore of every collection would take under real
pressure — step 3's number is for the data volume you have today.

**It is legitimate to decide not to do this.** PITR has cut the likelihood of the loss it insures
against, and the drill costs real money and real care. What is not legitimate is believing it has
been done: `KNOWN_LIMITATIONS.md` states the gap plainly for that reason, and nothing in this
repository schedules the drill — adding a row to `MAINTENANCE_CALENDAR.md` is the owner's call.

---

## Incident playbooks

### A. A shift / annual-leave / absence override was deleted or set wrong

**Symptom:** a day shows the wrong shift, or a booked leave/absence vanished.

1. **If you know what it should be — just re-enter it.** This is the normal, fastest fix:
   Admin → **Change a Shift** (or the AL / Absence card) → set the correct value → save.
   A manual save goes to ONE fixed document per member and date, `m_<date>_<encoded name>`
   (`manualOverrideId`, override-id.js); roster imports keep random ids and may sit beside
   it, the manual one winning. Re-creating one is a normal save, not a "restore" — and if you ever
   copy a record back by hand, keep its ORIGINAL id: a manual record under a random id is the
   duplicate that counts a day of leave twice.
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

1. Re-upload the **correct** PDF for the same week via Operations → **Weekly Roster**.
2. Review the changes — only the days that differ are listed; on a conflict choose **Keep saved**
   or **Use new roster**. Save.
3. If a wrong value was already *manually* re-saved on top, fix that day via **Change a
   Shift** (playbook A).
4. Only if the correct source PDF is unavailable *and* PITR is on: export a pre-upload
   snapshot (playbook A step 2) to read the affected days, then re-enter them.

### C. A Link Design was lost or corrupted

**Symptom:** a design in the Links workspace is gone or scrambled.

- `linkDesigns` docs are `{ name, patterns, window, updatedAt, updatedBy }` plus the `revision` the
  store stamps on every save (copy it back too: it is the co-editing identity) — the shape is
  `docPayload` in `links-design-doc.js`, which exists precisely so nobody hand-builds another copy
  of it. **`window` is load-bearing.** A design restored without its window comes back wearing the
  app default, the heat map then measures its gaps against a span nobody chose, and the next save
  writes that default over the moved boundary the design was built to test.
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
   Watch the Actions run to green. **If `main` carries the status-check ruleset**
   (OPERATIONS_REFERENCE.md → "The Pages mirror — putting it behind the Hosting gate", step 1), a
   direct push is refused unless you are on its bypass list: push the revert to a branch and merge
   it as a pull request once CI passes. The same applies to every `git push origin main` below.
2. **Emergency local redeploy** (if Actions itself is the problem), from a good checkout:
   ```
   firebase deploy --only functions --project myb-roster
   ```
3. Check function logs to confirm recovery: **Console → Functions → Logs**, or
   `firebase functions:log`.
4. Secrets (`HUDDLE_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`, `CALENDAR_VIEWER_PIN`) live in
   Firebase Secret Manager — a deploy doesn't wipe them; a broken function is almost always code, not secrets.

### F. A Firestore / Storage Rules deploy locked people out (or opened access)

Rules are the security boundary — a bad rules change can silently break every write, or
over-expose data. This is the **fastest** thing to roll back.

**First: is it the rules at all?** If members are denied everywhere after a CLAIMS change (a new
claim required, a tier moved), that is a claim problem and a rules rollback is the wrong tool. Run
Operations → Staff Login Accounts → **Set up accounts**, read its ❌ failed and 🔁 taken-back lines and
the account audit beneath it, then let tokens refresh (within an hour, or at once via a
`CLAIM_EPOCH` bump). **Never roll the rules back past v24.23** (the member-claim binding): anything
older believes a `name` any anonymous session can give itself.

1. **Console rollback (seconds, no deploy):** **Firestore → Rules → (version history)** →
   pick the immediately previous version → **Rollback**. Same for **Storage → Rules**.
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

1. **Revert the commit** and let `deploy-hosting.yml` redeploy — **the only route that reaches BOTH
   origins.** Most staff open the GitHub Pages mirror, which builds from `main` (or, once its source
   is switched, follows a completed Hosting workflow run — `deploy-mirror.yml`). A Console rollback
   runs neither, so the mirror keeps serving the broken release.
2. **Hosting rollback (fastest, `myb-roster.web.app` ONLY):** **Console → Hosting → release history →
   Rollback** to the previous release — a stopgap while the revert deploys, never the whole fix.
   (There is **no `firebase hosting:rollback` CLI command** — the Console button is the rollback
   path. The nearest CLI equivalent is `firebase hosting:clone` from a known-good preview channel,
   which only helps if one exists.) Verify BOTH live URLs afterwards.
3. After recovery, re-check the deployment health list in `CLAUDE.md` (the live-URL checks),
   especially if the change touched `firebase.json` (CSP/headers) or the Firebase SDK version.

### H. GitHub-mirror failover — the live site is broken by Hosting infra, not app code

The mirror at `https://garethdavidmiller.github.io/roster-app/` is served by **GitHub Pages**,
completely independent of Firebase Hosting's infrastructure (it builds from `main`, or — once its
source is switched — publishes what a passing Hosting run released).

- **It helps when the problem is Firebase *Hosting infrastructure*** (a bad hosting config,
  a Hosting outage) — direct staff to the mirror URL (note the `/roster-app/` path; the bare
  origin 404s).
- **It does *not* help for an app-code bug** — the mirror serves the same code, so it has the
  same bug. For code bugs, fix/roll back the code (playbook G).
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
| Bad roster upload | Re-upload correct PDF (self-heals imports) | Operations → Weekly Roster |
| Link design lost | Regenerate, or read old `patterns` from a PITR snapshot | Links workspace |
| Doc won't open / wrong date | Re-upload for the correct date | Operations |
| Bad Functions deploy | `git revert` + push, or `firebase deploy --only functions` | git / CLI |
| Bad Rules deploy | Console → Rules → Rollback to the previous version (seconds) — never past v24.23 | Firebase Console |
| Members denied everywhere after a claims change | Set up accounts (read failed/taken-back lines + audit), then wait ≤1h or bump `CLAIM_EPOCH` — not a rules rollback | Operations |
| Broken live site | Revert the commit (reaches both origins); Console → Hosting → Rollback fixes `web.app` only | git + Firebase Console |
| Hosting infra down | Point staff at the `/roster-app/` GitHub mirror | — |
| Everything failing at once | Check status pages; wait; don't redeploy | status.firebase.google.com |
| Auth silently failing | Check API-key referrer allowlist | GCP → Credentials |
| Genuine data loss | PITR snapshot export → read → re-enter by hand | gcloud |

---

## Related docs

- `CLAUDE.md` — project identity, deployment health checks, API-key referrer allowlist.
- `DATA_MODEL.md` — every collection's fields, which is what a hand-restored record must match.
- `OPERATIONS_REFERENCE.md` — Huddle/roster ingest flow, the Calendar PIN's operation (setting and
  rotating it), and Security Rules detail.
- `SECURITY_RELEASE_PLAN.md` — WIF deploy identity, claim model, the deferred security work.
- `KNOWN_LIMITATIONS.md` — "The installed PWA masks live-site breakage" (why you must verify
  in a fresh window).

---

## The Calendar PIN — deployment order, and breaking glass

### Deploying it — the order is the whole safety story

**The rollout is closed** (rules step 4 on 26 Aug 2026, verified in production on 27 Aug). The steps
below are kept because they are the template for any change that TIGHTENS a read rule, and because
code cites them by number. The PIN's own client switch (`CONFIG.CALENDAR_PIN_ACCESS`) has since been
retired, so none of this is a rollback route any more: **rolling back now means reverting step 4's
rules push** (or the release), never flipping a client flag.

**Never deploy the rules first.** A client that cannot satisfy a tightened read rule shows every staff
phone the base roster with a "Couldn't update" chip — a roster that is *wrong*, not obviously broken.

**That ordering has to be made by hand, because the three deploy workflows do not provide it.**
`deploy-functions.yml`, `deploy-hosting.yml` and `deploy-rules.yml` all fire from the same push to
`main`, in parallel, with no sequencing between them — so a single merge carrying the function, the
client and the rules performs steps 2, 3 and 4 *simultaneously*, and whether the rules land before
or after the hosting deploy is a coin toss. Ship it as separate pushes. For the PIN that meant two
brakes, each released by its own push: the client switch (step 3) and the `allow read;` hold line in
`firestore.rules` (step 4). The hold line was declared a second time as `OVERRIDES_READ_HELD_OPEN` in
`firestore.rules.test.mjs`, and `calendar-viewer-parity.test.mjs` fails if the two disagree in either
direction — which is what stopped the hold outliving the rollout: it could not be forgotten quietly,
only removed deliberately.

1. **Secret — BEFORE the merge, not after.** `firebase functions:secrets:set CALENDAR_VIEWER_PIN`.
   This is not merely "nothing works without it": `firebase deploy --only functions` resolves the
   `latest` version of every secret bound to a deploying endpoint (`validateSecretVersions` in
   firebase-tools) and throws if one has no version. `defineSecret` creating the container is not
   enough — an empty secret still fails. And the check covers the WHOLE deploy, so an unset PIN does
   not fail just `unlockCalendarViewer`; it fails `ingestHuddle`, `parseRosterPDF` and everything
   else in the same run. The live functions keep serving their current revision, so nothing breaks
   for staff, but the push ships no function code and opens a deploy-failure issue. Recoverable —
   set the secret and run the workflow again on `main` (Actions → Deploy Firebase Functions → Run
   workflow) — but the cheap move is to set it first.
2. **Merge, and the function goes live with it** — a dark deploy, with both brakes still on, whose job
   is to prove the *rest* of the release (session handling, the nav drawer, the calendar bootstrap)
   against real devices while the feature itself is invisible.
2b. **Prove the SUCCESS path in production, by hand, BEFORE step 3.** Someone holding the PIN opens
   the live Calendar in a private window and unlocks it. There is no automated substitute: it is the
   only way the token mint is exercised against real IAM, real Auth and the real secret — the e2e
   suite stubs the exchange (rightly — a test must not hold the secret). **A `GET` → 405 and a WRONG
   PIN → 401 prove nothing**: `getUser`/`createUser`, `setCustomUserClaims` and `createCustomToken`
   run only for a CORRECT PIN. That is exactly how step 3 failed on 10 Aug 2026 — every correct PIN
   returned 500 from the token-mint block, and it had to be reverted within hours. If it fails, read
   the function log: `[unlockCalendarViewer] token mint failed <code> <message>` names the cause. The
   known candidate is the IAM gap in the project-facts table above.
3. **Client.** Release the client that can satisfy the new rule — hosting only, no rules change — and
   **let it soak** while the rule is still permissive, so a stale cached client keeps working.
4. **Rules.** Remove the `allow read;` hold line and set `OVERRIDES_READ_HELD_OPEN = false` in the
   same commit; push with nothing else in it. From this moment an old cached client cannot read
   overrides, and the rollback is step 4's own revert.

   **The go/no-go was taken on 26 Aug 2026** on the pre-flight below: most real loads had moved off
   the pre-v20.51 client, and page views were broadly level with July.

   **What the soak is for:** not proving the PIN works — that was step 2b — but *how many devices are
   still running a client that cannot satisfy the new rule*, because those are the ones this step
   breaks for one load. Every day converts more of them, and only opening the app converts one. Count
   from the version that actually carried the client — a version that released it and was then rolled
   back does not count (for the PIN that was v20.51, not v20.46).

   **Pre-flight, in this order:**
   1. **Operations → App Speed → "A closer look" → By app version.** The share of real loads still on
      a client older than the cutover version. This is the number that decides go/no-go; a trickle is
      fine. Versions roll up into ranges, so a range that straddles the cutover is mostly converted but
      not provably so — and the card aggregates the WHOLE MONTH, so it is pessimistic about how stale
      devices are TODAY.
   2. **Operations → Usage → page views** against the period before the client shipped. A successful
      unlock records usage and a failed one records nothing, so a material drop means unlocks are
      failing. **This is the only soak signal there is** — a locked Calendar has no identity, so a
      failing PIN exchange never reaches the Error Log. Silence there is not health. Page views are
      stored per MONTH (`analytics/pv_<YYYY-MM>`) with no daily bucket, so a 7-day window cannot be
      read; either add a daily bucket first or write the pre-flight against what the cards hold.
   3. `unlockCalendarViewer` in the Functions log, for outright errors.
   4. The rules deploy path is green. Do not ship step 4 on top of a red rules workflow.

   **Be free to postpone.** An exposure that has stood for years costs little for another fortnight;
   getting a roster wrong for somebody on their first shift back costs more.
5. **Verify in production**, in a fresh private window: PIN → roster → reload → still unlocked →
   Team View → month navigation → Admin (must demand a member sign-in) → close the browser →
   PIN again. Then on a phone, and at an office-desktop width. This step is a person and not a job,
   for the reason step 2b gives.

**The mixed-version window at step 4** is one page load wide: the service worker claims immediately
on activate and reloads the page, so a device is on the new client by its next open. Within that one
load an old client shows the base roster plus the sync chip's "Couldn't update — try again". That
is visible and recoverable, and step 3's soak is what keeps the window to a single load rather than
a deploy cycle.

### If viewer authentication fails in production

**Restore access through the sign-in card, not through the rules.** A member signing in with their own
password never touches `unlockCalendarViewer`, so their way in still works. Opening the `overrides` read
rule (`allow read;`) would restore NOTHING: the Calendar decides access in the browser and draws the PIN
card for anyone who is not a member or a viewer, whatever the rules say (`decideAccess`,
`calendar-access-core.js`). It could not ship through the pipeline either — `calendar-viewer-parity.test.mjs`
fails a bare `allow read;` that nothing declares, and `deploy-rules.yml` runs `npm run check` first.

1. Tell staff to use the sign-in card with their own password. A shared station PC has no way in until
   the exchange is fixed — say so plainly rather than leaving them to retry.
2. Diagnose from the Cloud Function logs (`unlockCalendarViewer`). A locked Calendar has no Firebase
   identity, so **nothing appears in the Operations Error Log** — do not read its silence as health.
   The usual causes are an unset or un-redeployed secret (`503`, or every PIN rejected) and a
   claim/uid mismatch between the function and the rules (unlock succeeds, no shifts appear).
3. Fix (the IAM grant in the project facts table above, the secret, a redeploy), then confirm the
   PIN from a fresh private window.

Do **not** leave it half-working: a Calendar that renders without its overrides is the one outcome
worse than a Calendar that will not open.

### If the PIN gets out

Rotation needs no client release — OPERATIONS_REFERENCE.md → "Rotating the Calendar PIN". Set the new
secret, redeploy the function, tell staff. Existing unlocked sessions keep working until their
browsers close; to kill those too, revoke the shared account's refresh tokens
(`getAuth().revokeRefreshTokens('calendar-viewer')`, from `firebase-admin/auth`) — which takes effect
at each session's next token refresh, within about an hour, not instantly. Member sessions are untouched either way.
**Do not DISABLE the `calendar-viewer` account as the kill switch** — the next correct unlock treats a
disabled account as tampered and rebuilds it from nothing, so a disable lasts only until somebody who
holds the PIN uses it. Rotate the PIN (and revoke the tokens) instead.
