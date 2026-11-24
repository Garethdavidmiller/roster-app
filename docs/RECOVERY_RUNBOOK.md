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
| Firestore collections | **Do not keep a list here — read the `match /<collection>/…` blocks at the top level of `firestore.rules`** (`grep -n '^    match /' firestore.rules`): every one is a collection to scope, and a backup scoped from a hand-kept list silently omits whole features. What a scope gets wrong: `overtimeWindows` is a TREE (`participants`/`submissions`/`revisions` subcollections — an export that takes the parent alone restores an empty week); losing `alUploads` makes the next annual-leave upload behave like the first, with no memory of leave an earlier Save brought in and the app has since cancelled; losing `errorLogNotice` costs nothing (the next check starts afresh). What each collection holds: `DATA_MODEL.md` |
| Storage paths | `huddles/…`, `circulars/…`, `newsletters/…` |
| Cloud Functions (europe-west2) | **Do not keep a second list here.** `functions-surface.test.mjs` pins the whole deploy surface in CI and is the only copy that cannot fall behind — read it. A rollback scoped from a hand-kept list misses whatever the list forgot. While Overtime is paused its five endpoints and daily creator are not exported (`OVERTIME_AVAILABILITY.md` → Paused) |
| Live site (primary) | `https://myb-roster.web.app` (Firebase Hosting) |
| Live site (mirror) | `https://garethdavidmiller.github.io/roster-app/` (GitHub Pages, published by `deploy-mirror.yml` after each passing Hosting run) |
| Deploy mechanism | GitHub Actions via Workload Identity Federation → `github-deploy@myb-roster.iam.gserviceaccount.com`. Workflows: `deploy-functions.yml`, `deploy-hosting.yml`, `deploy-rules.yml`, and `deploy-mirror.yml` (the Pages mirror, since its source was switched to GitHub Actions on 10 November 2026) |
| Source of truth for a rollback | this git repo — `main` is what deploys |
| **IAM prerequisite for `getDocumentUrl`** (first needed by the retired staff PIN's `unlockCalendarViewer`, deleted in its server release — KEEP it) | The Cloud Run runtime service account — currently `532910998075-compute@developer.gserviceaccount.com` — must hold **`roles/iam.serviceAccountTokenCreator` on itself**, and `iamcredentials.googleapis.com` must be enabled. Under Application Default Credentials the Admin SDK cannot sign locally (`getSignedUrl`, and the PIN exchange's `createCustomToken`); it calls the IAM Credentials API. **Gen-2 does not grant this by default and nothing in the repo can enforce it** — its absence caused the 10 Aug 2026 outage, in which every correct PIN returned 500 while every wrong one returned a healthy 401. Re-apply it if the runtime service account changes, if the function is given its own service account, or if the project is rebuilt (the command is §5b below). |

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
you can `git revert` in an emergency — and `git pull` it before you deploy anything from it:
`firebase deploy` uploads the folder it runs in, so an old clone puts old code live.

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
an `@myb-roster.iam` one — and it is the SAME grant as the IAM prerequisite there, which the retired
staff PIN's exchange needed first. Keep it: that exchange is deleted, `getDocumentUrl` is not.

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
   (OPERATIONS_REFERENCE.md → "The Pages mirror", step 1 — not yet set on 10 November 2026), a
   direct push is refused unless you are on its bypass list: push the revert to a branch and merge
   it as a pull request once CI passes. The same applies to every `git push origin main` below.
2. **Emergency local redeploy** (if Actions itself is the problem), only from a checkout of today's
   `main` with step 1's revert in it — `git pull` first, because `firebase deploy` uploads the
   `functions/` folder it runs in:
   ```
   firebase deploy --only functions --project myb-roster
   ```
3. Check function logs to confirm recovery: **Console → Functions → Logs**, or
   `firebase functions:log`.
4. Secrets (`HUDDLE_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`, and the retired `CALENDAR_VIEWER_PIN` — bound by no function, until the owner destroys it) live in
   Firebase Secret Manager — a deploy doesn't wipe them; a broken function is almost always code, not secrets.

### F. A Firestore / Storage Rules deploy locked people out (or opened access)

Rules are the security boundary — a bad rules change can silently break every write, or
over-expose data. This is the **fastest** thing to roll back.

**First: is it the rules at all?** If members are denied everywhere after a CLAIMS change (a new
claim required, a tier moved), that is a claim problem and a rules rollback is the wrong tool. Run
Operations → Staff Login Accounts → **Set up accounts**, read its ❌ "Failed" and 🔁 "Reset to the
default password and signed out" lines and the account audit beneath it, then let tokens refresh
(within an hour, or at once via a `CLAIM_EPOCH` bump). **Never roll the rules back past v24.23** (the member-claim binding): anything
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
   Firebase Auth call fail, and nothing on screen names the cause: a typed sign-in says only
   "Couldn’t sign you in. Try again — if it keeps happening, ask the admin." It must include `myb-roster.web.app/*`,
   `myb-roster.firebaseapp.com/*`, and `garethdavidmiller.github.io/*`.

### G. A Hosting deploy broke the live site (blank page, CSP error, 404)

**Remember the trap:** your own installed phone loads from its service-worker cache and will
look fine **even when the live site is completely broken**. Always verify in a **fresh
private window** (no cache, no SW): does `https://myb-roster.web.app` load *past* the splash
to the calendar, with no red console errors?

1. **Revert the commit** and let `deploy-hosting.yml` redeploy — **the only route that reaches BOTH
   origins.** Most staff open the GitHub Pages mirror, which `deploy-mirror.yml` publishes after
   each passing Hosting run. A Console rollback runs neither, so the mirror keeps serving the broken
   release.
2. **Hosting rollback (fastest, `myb-roster.web.app` ONLY):** **Console → Hosting → release history →
   Rollback** to the previous release — a stopgap while the revert deploys, never the whole fix.
   (There is **no `firebase hosting:rollback` CLI command** — the Console button is the rollback
   path. The nearest CLI equivalent is `firebase hosting:clone` from a known-good preview channel,
   which only helps if one exists.) Verify BOTH live URLs afterwards.
3. After recovery, re-check the deployment health list in `CLAUDE.md` (the live-URL checks),
   especially if the change touched `firebase.json` (CSP/headers) or the Firebase SDK version.

### H. GitHub-mirror failover — the live site is broken by Hosting infra, not app code

The mirror at `https://garethdavidmiller.github.io/roster-app/` is served by **GitHub Pages**,
completely independent of Firebase Hosting's infrastructure. Since 10 November 2026 it publishes
what a passing Hosting run released, through `deploy-mirror.yml`.

- **It helps when the problem is Firebase *Hosting infrastructure*** (a bad hosting config,
  a Hosting outage) — direct staff to the mirror URL (note the `/roster-app/` path; the bare
  origin 404s). While Hosting is down no new release reaches the mirror either, because it
  publishes only after a successful Hosting run, so it keeps serving the last good one.
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

### J. Restoring a lost admin claim

**Symptom:** Operations → Staff Login Accounts says *"Your account is missing the admin claim"*, or
every admin action answers 403 "admin claim required". The admin can still sign in; the account
has lost `admin: true`, which only `setupRosterAuth` stamps — and that endpoint itself needs it.

**The Firebase console cannot fix this.** It can disable, delete and re-password an account, but it
has no field for a custom claim; only the Admin SDK can set one.

1. **First find out why, or it comes straight back.** Set up accounts stamps the tiers from the
   DEPLOYED `functions/roster-members.json`. Check the name is in `CONFIG.ADMIN_NAMES`
   (`roster-data.js`) **and** in `roles.admin` there. If it is not, fix the roster, run
   `npm run generate:roster-members`, and wait for Deploy Firebase Functions — otherwise the next
   Set up accounts run takes `admin` away again and signs the account out.
2. **If another account still holds the claim**, sign in as it and press **Set up accounts**. Done —
   no script.
3. **Otherwise, a one-off Admin SDK script, run on your own computer.** You need the Google Cloud
   CLI, signed in for Application Default Credentials as an account with Firebase Authentication
   Admin (or Owner) on `myb-roster`, and `functions/node_modules` installed (`cd functions && npm ci`):
   ```
   gcloud auth application-default login
   node -e "console.log(require('./functions/roster-parse-helpers').nameToEmail('X. Surname'))"
   ```
   The second line prints the account address the app derives from the name, exactly as
   `nameToEmail` does. Save this **outside the repository** — it must never be committed — with your
   own name and that address in place of the placeholders:
   ```js
   // restore-admin-claim.cjs — one-off. Never commit it.
   const { initializeApp, applicationDefault } = require('firebase-admin/app');
   const { getAuth } = require('firebase-admin/auth');

   const NAME  = 'X. Surname';                   // exactly as written in CONFIG.ADMIN_NAMES
   const EMAIL = 'x.surname@myb-roster.local';   // what the nameToEmail line printed

   initializeApp({ credential: applicationDefault(), projectId: 'myb-roster' });
   (async () => {
       const user = await getAuth().getUserByEmail(EMAIL);
       const existing = user.customClaims || {};
       if (existing.member && existing.member !== NAME) throw new Error(`claimed for ${existing.member} — stop`);
       if (existing.calendarViewer) throw new Error('this is the shared staff PIN account — stop');
       // The admin tier exactly as claimsForTier stamps it: name and member, admin, and never manager beside it.
       const { manager, ...kept } = existing;   // linksDesigner, if held, is kept
       const claims = { ...kept, name: NAME, member: NAME, admin: true };
       await getAuth().setCustomUserClaims(user.uid, claims);
       console.log('was', existing, '\nnow', claims);
   })().catch((e) => { console.error(e.message); process.exitCode = 1; });
   ```
   Run it with the repository's own copy of the SDK:
   ```
   NODE_PATH=<path to the repository>/functions/node_modules node restore-admin-claim.cjs
   ```
   `name` and `member` must both equal the roster name: the Firestore rules and every member
   endpoint believe a name only beside a `member` claim that matches it (AUTH_AND_SESSIONS.md).
   An account that already carries a claim is never taken back by Set up accounts (`mustReclaim`,
   `functions/member-identity.js`), so the claim set here is not undone as an outsider's.
4. **Sign out of the app and back in**, so the device's token carries the new claim, then press
   **Set up accounts** once: it re-stamps every tier from the roster, this one included, and its
   audit line should read clean. Delete the script.

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
| Bad Functions deploy | `git revert` + push; only if Actions is down, `firebase deploy --only functions` from a pulled checkout of `main` with the revert | git / CLI |
| Bad Rules deploy | Console → Rules → Rollback to the previous version (seconds) — never past v24.23 | Firebase Console |
| Members denied everywhere after a claims change | Set up accounts (read its ❌ Failed and 🔁 Reset lines + audit), then wait ≤1h or bump `CLAIM_EPOCH` — not a rules rollback | Operations |
| The admin lost the admin claim | Playbook J — the console cannot set a claim; another admin's Set up accounts, or a one-off Admin SDK script | local + Operations |
| Broken live site | Revert the commit (reaches both origins); Console → Hosting → Rollback fixes `web.app` only | git + Firebase Console |
| Hosting infra down | Point staff at the `/roster-app/` GitHub mirror | — |
| Everything failing at once | Check status pages; wait; don't redeploy | status.firebase.google.com |
| Auth silently failing | Check API-key referrer allowlist | GCP → Credentials |
| Genuine data loss | PITR snapshot export → read → re-enter by hand | gcloud |

---

## Related docs

- `CLAUDE.md` — project identity, deployment health checks, API-key referrer allowlist.
- `DATA_MODEL.md` — every collection's fields, which is what a hand-restored record must match.
- `OPERATIONS_REFERENCE.md` — Huddle/roster ingest flow, the retired staff PIN's last manual steps,
  and Security Rules detail.
- `SECURITY_RELEASE_PLAN.md` — WIF deploy identity, claim model, the deferred security work.
- `KNOWN_LIMITATIONS.md` — "The installed PWA masks live-site breakage" (why you must verify
  in a fresh window).

---

## The staff PIN (retired)

**Retired 23 Nov 2026 (owner).** The Calendar and Trains open only to somebody signed in by name; the
shared PIN opens nothing in the app. It comes out in three releases — client, server, cleanup —
recorded in DECISIONS.md → "The staff PIN retired". What staff are told, how somebody without a login
gets one, and **the manual steps after the server release** (delete the `calendar-viewer` account,
destroy `CALENDAR_VIEWER_PIN`, purge `viewerAttempts`, consider switching off Anonymous sign-in, KEEP
the token-creator grant): OPERATIONS_REFERENCE.md → "The staff PIN (retired)".

**The server release has shipped: the PIN opens nothing, at the endpoint or anywhere else.**
`unlockCalendarViewer` is deleted (the Functions deploy runs `--force`, which deletes a function the
source no longer exports), and the rules and `getDocumentUrl` grant the `calendarViewer` claim nothing.
Between the client and the server release the PIN still worked at the endpoint, which is why the
second release did not wait long.

**The server release tightened a read rule**, so it shipped AFTER the client release had soaked,
never in the same push — the order below. An app that has not updated yet still shows the PIN box;
since the server release its unlock fails with the card's generic "couldn't unlock" line, and the next
load of the new app offers the sign-in card. If members lose the roster after the rules deploy, that
is playbook F: revert the rules push. Nobody needs the PIN back to recover — a member's own password
never went near it. **Do not restore the function to "fix" anything**: re-adding the export would
bring a shared code back for whoever finds the URL, and the rules would still grant its token nothing.

### Tightening a read rule — the order is the whole safety story

**The PIN's own rollout closed** (rules step 4 on 26 Aug 2026, verified in production on 27 Aug), and
the PIN itself is now retired (above). Its narrative — the brakes, the 10 Aug failure, the go/no-go
readings — is `ROADMAP_HISTORY.md` → "The Calendar PIN rollout (moved from RECOVERY_RUNBOOK.md,
24 Nov 2026)". **What stays here is the playbook it proved, for any change that TIGHTENS a read
rule**; the step numbers are cited elsewhere, so they are kept.

**Never deploy the rules first.** A client that cannot satisfy a tightened read rule shows every staff
phone a roster that is *wrong*, not obviously broken (the base roster with a "Couldn't update" chip).
**The three deploy workflows fire in parallel from one push**, so a merge carrying the function, the
client and the rules runs steps 2, 3 and 4 simultaneously. Ship them as separate pushes, and hold the
old rule open with a declared hold line that a parity test pins (the PIN's was `allow read;` beside
`OVERRIDES_READ_HELD_OPEN` in `firestore.rules.test.mjs`, held to it by
`calendar-viewer-parity.test.mjs`), so the hold cannot outlive the rollout quietly.

1. **Secrets — BEFORE the merge.** `firebase deploy --only functions` throws if any secret bound to a
   deploying endpoint has no version, and the check covers the WHOLE deploy: one unset secret ships no
   function code at all (the live revisions keep serving). Recoverable — set it, then Actions → Deploy
   Firebase Functions → Run workflow on `main` — but set it first.
2. **Merge; the server side goes live dark**, with the brakes on, proving the rest of the release on
   real devices while the feature is invisible.
2b. **Prove the SUCCESS path in production, by hand, BEFORE step 3.** Probes that stop short of the
   work (a `GET`, a deliberately wrong credential) prove nothing — the 10 Aug 2026 failure passed both.
   Read the function log on failure; the known candidate is the IAM gap in the project-facts table.
3. **Client.** Release the client that can satisfy the new rule — hosting only, no rules change — and
   **let it soak** while the rule is still permissive, so a stale cached client keeps working.
4. **Rules.** Remove the hold line and its declared twin in the same commit; push with nothing else in
   it. From this moment an old cached client cannot read, and the rollback is this push's revert.
   **The soak decides go/no-go**, and it measures how many devices still run a client that cannot
   satisfy the rule — count from the version that actually carried it, not one rolled back. Pre-flight,
   in order: (1) Operations → App Speed → "A closer look" → By app version — the share of loads still
   older than the cutover (a month's aggregate, so pessimistic); (2) Operations → Usage → page views
   against the period before the client shipped — for an unauthenticated surface the only soak signal
   there is, because a failure never reaches the Error Log; (3) the function's own log; (4) a green
   rules deploy path. **Be free to postpone.**
5. **Verify in production**, in a fresh private window and then on a phone and at office-desktop
   width: every path the rule now guards, including a reload, a sub-page that must demand a member
   sign-in, and a browser close. A person, not a job, for step 2b's reason.

**The mixed-version window at step 4** is one page load wide: the service worker claims on activate
and reloads, so a device is on the new client by its next open, and within that load an old client
shows the base roster plus "Couldn't update — try again". Step 3's soak keeps it to one load.
