# Operations Reference — MYB Roster App

*Last updated: July 2026 — v18.60 · Updated every 0.10 version*

Operational detail that is rarely needed in day-to-day development sessions. Referenced from `CLAUDE.md`.

---

## Huddle ingest — full detail

### Firebase Storage

Files stored at a **versioned** path: `huddles/YYYY-MM-DD-{uploadId}.pdf` (or `.docx`), where
`{uploadId}` is a short random suffix. The versioned suffix lets a re-upload for the same date
write the new object before the old one is deleted, so a re-upload (incl. a PDF↔DOCX swap) never
orphans the previous file or races the Firestore commit. The exact path is recorded in the
`storagePath` field. (Docs written before versioned paths have no `storagePath`; the browser
`uploadHuddle` cleanup falls back to the legacy fixed `huddles/{date}.{fileType}`, and the prune
sweeps by prefix — see Auto-prune below.)

Storage URL strategy (v15.19+): `ingestHuddle` writes a permanent `firebaseStorageDownloadTokens`
download URL to `storageUrl`. It does NOT use a signed URL — GCS caps v4 signed-URL expiry at
7 days, far shorter than the 3-month Huddle retention window (the old "1-year signed URL" code
always threw and silently fell back to the token path anyway).

Download-token URL format (`ingestHuddle` always writes this — it never uses a signed URL):
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD-{uploadId}.pdf?alt=media&token={uuid}
```

**Auto-prune (3 months):** at the end of every `ingestHuddle` run, `pruneOldHuddles()` deletes
huddle Firestore docs *and* their Storage objects older than 3 months (`HUDDLE_RETENTION_MONTHS`).
Storage deletion sweeps by the `huddles/<date>` **prefix** (Jul 2026, a functions-only change —
no app-version bump) — covering versioned paths, legacy fixed paths, and orphaned objects alike,
superseding the old storagePath-based delete.
It is awaited (so it runs before Cloud Run reclaims the container) but best-effort — failures are
swallowed and never block the upload response. Circulars/newsletters keep 6 months; huddles are
higher-volume and rarely referenced after the day, so retention is shorter.

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle).

```
date         string     "YYYY-MM-DD"
storageUrl   string     Download-token URL (see above)
storagePath  string     Versioned Storage object path, e.g. "huddles/2026-06-25-lv9kab12.pdf"
                        (absent on docs written before versioned paths — the prune's prefix sweep covers those too)
fileType     string     "pdf" | "docx" (browser writes are rule-constrained to these since v14.29)
uploadedAt   timestamp  Firestore server timestamp
uploadedBy   string     "power-automate" (Cloud Function) | member name string (manual admin upload)
htmlContent  string     (optional) DOCX converted to HTML by mammoth.js at upload time.
                        Present for DOCX files only. Missing for PDFs and large DOCX
                        conversions (> 200 KB / 200,000 chars). Viewer falls back to storageUrl if absent.
```

### Cloud Function — `ingestHuddle` request format

```
Headers:
  Authorization:      Bearer <HUDDLE_SECRET>
  Content-Type:       text/plain
  X-Huddle-Date:      YYYY-MM-DD
  X-Huddle-Filename:  original-name.pdf   (or .docx)

Body:
  Raw base64-encoded file content — plain text, no JSON wrapper
```

**Why plain-text body instead of JSON?** Power Automate's `@{body('...')?['contentBytes']}` template substitution in a JSON body silently truncates large base64 strings. Putting the file in the raw body as `text/plain` bypasses this. Metadata goes in custom headers instead.

**Body reading:** The function reads `req.rawBody` first; falls back to streaming. Never use an Express body-parser — it consumes the stream.

**File type detection:** Based on `X-Huddle-Filename` extension — never rely on `Content-Type` (Power Automate sends `text/plain` for both).

### Secret setup (one-time, requires firebase-tools)

```bash
firebase login
firebase use myb-roster
firebase functions:secrets:set HUDDLE_SECRET   # paste a strong random UUID
cd functions && npm install
```

Generate a secret: `node -e "console.log(require('crypto').randomUUID())"`

Find in Firebase Console: Build → Functions → Secret Manager (or Google Cloud Console → Security → Secret Manager, project `myb-roster`).

### Power Automate flow — "huddle ingest"

Uses the **HTTP** (Premium) connector — not "Send an HTTP request (Office 365)".

**Trigger:** "When a new email arrives (V3)" on the Huddle mailbox, filtered to emails with attachments.

**Priority:** DOCX is preferred — it converts to HTML server-side and renders inline in the app. PDF is the fallback if no DOCX attachment is present. The old time-of-day condition (before/after noon) has been replaced with an attachment-type check.

**Overall structure:**

```
Trigger: new email with attachment
│
├── Compose: London_time
│   convertTimeZone(triggerOutputs()?['body/receivedDateTime'],
│                   'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
│
├── Set variable: huddleDate  ← outputs('London_time')
│
├── Filter array: find_docx
│   From: triggerOutputs()?['body/attachments']    (expression tab)
│   Condition: item()?['contentType']              (expression tab)
│              is equal to
│              application/vnd.openxmlformats-officedocument.wordprocessingml.document
│                                                  (value tab)
│
└── Condition: DOCX found?
    greater(length(body('find_docx')), 0)          (expression tab)
    │
    ├── YES branch — send the DOCX:
    │   ├── Compose: huddle_bytes
    │   │   body('find_docx')[0]?['contentBytes']  (expression tab)
    │   │
    │   └── HTTP action (Premium)
    │       Method: POST
    │       URI: https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle
    │         (value tab)
    │       Headers:
    │         Authorization     →  Bearer <paste secret here>              (value tab)
    │         Content-Type      →  text/plain                              (value tab)
    │         X-Huddle-Date     →  @{variables('huddleDate')}             (value tab)
    │         X-Huddle-Filename →  @{body('find_docx')[0]?['name']}       (value tab)
    │       Body: @{outputs('huddle_bytes')}                               (value tab)
    │
    └── NO branch — try PDF fallback:
        ├── Filter array: find_pdf
        │   From: triggerOutputs()?['body/attachments']  (expression tab)
        │   Condition: item()?['contentType']            (expression tab)
        │              is equal to
        │              application/pdf                   (value tab)
        │
        └── Condition: PDF found?
            greater(length(body('find_pdf')), 0)         (expression tab)
            │
            ├── YES branch — send the PDF:
            │   ├── Compose: huddle_bytes_pdf
            │   │   body('find_pdf')[0]?['contentBytes'] (expression tab)
            │   │
            │   └── HTTP action (Premium)
            │       (same structure as DOCX branch)
            │       X-Huddle-Filename → @{body('find_pdf')[0]?['name']}   (value tab)
            │       Body: @{outputs('huddle_bytes_pdf')}                   (value tab)
            │
            └── NO branch — no suitable attachment, do nothing
```

### Critical Power Automate gotchas

**1. Expression tab vs value tab** — Getting this wrong silently breaks the flow:

| What you're entering | Which tab |
|---------------------|-----------|
| `item()?['contentType']` — left side of filter condition | Expression |
| `application/pdf` — right side of filter condition | Value |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — DOCX filter | Value |
| `greater(length(body('find_docx')), 0)` — condition expression | Expression |
| `body('find_docx')[0]?['contentBytes']` — Compose source | Expression |
| The Cloud Function URL | Value |
| `Bearer <secret>` — Authorization header value | Value |
| `text/plain` — Content-Type header value | Value |
| `@{variables('huddleDate')}` — X-Huddle-Date header value | Value (the @{} syntax works in value tab) |
| `@{body('find_docx')[0]?['name']}` — X-Huddle-Filename | Value |
| `@{outputs('huddle_bytes')}` — HTTP body | Value |

**2. Filter array returning empty — the most common failure**
If a filter condition finds nothing, `body('find_docx')[0]` throws "array index 0 cannot be selected from empty array". The nested condition structure (check length first) prevents this — never reference `[0]` outside a condition that guards it.
- Left side of filter condition must be on **expression** tab (value tab compares literal string)
- DOCX MIME type is 71 characters and easy to mistype — copy it exactly:
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- "From" field must reference `triggerOutputs()?['body/attachments']` directly

**3. London timezone** — The Compose action must be named `London_time` (underscore, not space). Action names with spaces cause `InvalidTemplate` errors. The expression **must include the `'yyyy-MM-dd'` format argument** — omitting it returns a full ISO datetime string (e.g. `2026-05-31T08:00:00.0000000`) which fails the strict `^\d{4}-\d{2}-\d{2}$` regex in `ingestHuddle` with HTTP 400. Every request would be rejected silently.

```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'], 'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
```
Note: `'GMT Standard Time'` has spaces — `'GMTStandardTime'` is invalid.

**4. `@{}` syntax in value tab** — Use `@{expression}` syntax to reference dynamic values in header/body fields while on the value tab. Do not switch to expression tab.

**5. HTTP action body** — Cannot reference a Compose action by name inside the action's own "inputs" scope. Always prepare the value in a separate Compose action first.

### Firestore Security Rules — `huddles` collection

Access posture: **read open, write admin-only**. (The live rule in `firestore.rules` is the
authority — since v14.29 it also shape-validates browser writes: `hasOnly` field allowlist,
bounded `YYYY-MM-DD` date, `fileType in ['pdf','docx']`, typed `uploadedAt`/`uploadedBy`, a
250,000-char `htmlContent` cap, and a separate admin-only delete rule. Don't quote the rule
here — it drifts; read the file.)

Read is open because `calendar-app.js` (index.html) has no Firebase Auth session — requiring auth
broke notification auto-open on fresh first visits (v10.76). Browser writes (the manual admin
upload path in `huddle.js`) require the admin claim (v10.83); the automated
`ingestHuddle` Cloud Function uses the Admin SDK, which bypasses rules entirely. The matching
Storage rule (`storage.rules`) also requires the admin claim for huddle file writes.

### Huddle notification tap behaviour (v10.71)

When a push notification is tapped, the service worker (`notificationclick` handler) **re-bases the payload's route onto its OWN scope** (`registration.scope`) and opens it via `focusedClient.navigate()` or `clients.openWindow()` — e.g. `https://myb-roster.web.app/#huddle` on a Firebase Hosting install (or `https://garethdavidmiller.github.io/roster-app/#huddle` on the GitHub Pages mirror). It deliberately ignores the payload's origin: the Cloud Function sets one `STAFF_SITE_URL` (now the canonical `https://myb-roster.web.app` since v14.29), but installs live on different origins/paths, so only the payload's trailing page + hash are used and the origin is taken from the SW's own scope. A bare-origin fallback was the cause of the 16 Jun 2026 notification 404 (fixed v14.26). On load — or via the `hashchange` listener if the page is already open — `calendar-huddle-viewer.js` fires `_triggerAutoOpen(huddle)`. The nav-panel **Daily Huddle** link points at the same `#huddle` hash, so it runs the identical path; there is no separate button trigger (the old `#huddleBtn` was removed at v12.57).

**Two render paths inside `_triggerAutoOpen` — do not unify:**

| `htmlContent` | Behaviour (identical for the nav-panel link and a notification tap) |
|---------------|--------------------------------------------------------------------|
| Present (DOCX converted server-side) | Renders sanitised HTML inline in the viewer overlay |
| Absent (PDF, or DOCX conversion failed) | Shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); tapping it calls `window.open(storageUrl, '_blank', 'noopener')` |

**Why the in-overlay button (no `htmlContent`):**

A notification tap provides no transient user activation in the page. This means:
- `window.open('_blank', ...)` → pop-up blocked by the browser (no user gesture)
- `window.location.href = storageUrl` → navigates the standalone PWA's top-level window to a cross-origin URL; Android wraps the app in browser chrome and the standalone window is lost

Tapping the in-overlay "📄 Open Huddle" button IS a real user gesture. `window.open(storageUrl, '_blank', 'noopener')` then opens the file as an Android Custom Tab overlaid on top of the intact standalone PWA. The Android Back gesture dismisses the Custom Tab and returns directly to the clean standalone app.

**Important:** Both triggers (nav-panel link and notification tap) reach the viewer through the `#huddle` hash and the single `_triggerAutoOpen` path, so the no-`htmlContent` case always opens the file via the in-overlay button — never a direct `window.open`/`location.href` at open time. A notification tap carries no user activation (direct `window.open` would be pop-up-blocked; a `location.href` to the cross-origin file would knock the PWA out of standalone mode), and routing both triggers through the explicit button avoids relying on activation that may not be present. DOCX files with `htmlContent` bypass this entirely — they render inline.

**Push notifications paused?** If `HUDDLE_PUSH_PAUSED` is `true` in `functions/index.js`, Huddle ingestion succeeds but no push is sent. To re-enable: set it back to `false`, redeploy Functions, and verify `STAFF_SITE_URL` is correct (since v14.29 it is the bare `https://myb-roster.web.app` origin — the service worker discards the payload origin/path and re-bases only the trailing page/hash onto its own `registration.scope`, so no `/roster-app` sub-path is needed; a notification-target mismatch was the real cause of the 16 Jun 2026 pause).

---

## Weekly Roster Upload — full detail

### Cloud Function — `parseRosterPDF`

- **Region:** `europe-west2` (London)
- **Auth:** Firebase ID token — browser sends `Authorization: Bearer <idToken>` where idToken comes from `auth.currentUser.getIdToken()`. The function validates via Firebase Admin SDK. `ROSTER_SECRET` is no longer used anywhere — both `parseRosterPDF` and `setupRosterAuth` use Firebase ID token auth with an admin custom claim.
- **CORS:** `cors: ADMIN_FUNCTION_ORIGINS` — an explicit origin allowlist (`functions/index.js`): `https://garethdavidmiller.github.io`, `https://myb-roster.web.app`, `https://myb-roster.firebaseapp.com`. This is defence-in-depth; the real control is the Firebase ID token + admin claim, so a browser from an unlisted origin is blocked at preflight *and* would fail auth. `setupRosterAuth` uses the same allowlist. Add any new hosting domain to the `ADMIN_FUNCTION_ORIGINS` array. (`ingestHuddle` keeps `cors: false` — server-to-server.)
- **AI model:** the `CLAUDE_MODEL` constant in `functions/index.js` — currently `claude-sonnet-5`, `max_tokens: 16000`, `thinking: { type: 'disabled' }`, non-streaming `messages.create`, `timeoutSeconds: 120`. Note this is an unversioned alias (it tracks the latest Sonnet 5 snapshot), not a dated pin; switch to a dated snapshot if reproducibility matters. **`thinking` is explicitly disabled** — Sonnet 5 runs adaptive thinking by DEFAULT when `thinking` is omitted (Sonnet 4.6 ran thinking-off), which — combined with Sonnet 5's ~30% higher token count — truncated the roster JSON past `max_tokens` and surfaced as "The AI returned an unreadable response". Disabling thinking restores the deterministic-extraction behaviour; `max_tokens` was raised 8192 → 16000 for headroom. **History (v16.27 → rolled back v16.28):** thinking was briefly re-enabled via streaming to improve day-column reading accuracy, but the live thinking+streaming call failed in production ("Couldn't read the roster — unexpected error"), so it was reverted. The day-shift accuracy issue is instead handled deterministically server-side, which does not depend on the model — so reading accuracy is protected without touching the AI call. Two server layers (v16.68): `applySundayScanCorrections` (the original Sunday-anchored Case A/B repair) and **`applyColumnScanCrossCheck`** — the prompt demands a second, column-by-column read of the whole table (`columnScan`) and every cell is cross-checked against the row read. Agreement → keep; a disagreement realigning exactly under a one-day suffix shift (anchored at the first disagreeing day, ≥2 disagreements, ≥5 signalled days) → deterministic repair; anything else → the cell becomes a skip-only `UNKNOWN|row or col? (PDF unclear)` UNREADABLE review cell carrying both readings. Fails open if the AI omits `columnScan`. A third, AI-independent layer runs client-side: `detectShiftedRow` (admin-roster-upload.js) correlates each parsed week against the member's own base roster at ±1-day offsets and shows a "these days may be one day out" banner on the review section when a shifted alignment fits much better — catching the residual case where both AI reads misread identically.
- **Why direct PDF input:** Text extraction (pdf-parse) destroys table column structure and causes day-column misalignment. Claude reads the visual layout directly.

**Request format:**

```
Headers:
  Authorization:   Bearer <Firebase ID token>
  Content-Type:    text/plain
  X-Week-Ending:   YYYY-MM-DD  (must be a Saturday — validated server-side)
  X-Roster-Type:   cea | ces | dispatcher

Body:
  Raw base64-encoded PDF content (same pattern as ingestHuddle)
```

**Response format:**

```json
{
  "weekEnding": "2026-04-05",
  "rosterType": "cea",
  "dates": ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
  "crossCheck": "complete",
  "missingMembers": [],
  "parsed": [
    {
      "memberName": "G. Miller",
      "shifts": {
        "2026-03-30": "RD",
        "2026-03-31": "06:00-14:00",
        "2026-04-01": "RDW|14:30-22:00"
      }
    }
  ]
}
```

- **`crossCheck`** (v16.70) — the column-scan cross-check status: `"complete"` (every returned member re-verified against an independent column read), `"partial"` (some), or `"unavailable"` (the AI omitted/garbled `columnScan` so the check never ran). The review UI shows an advisory note when it isn't `"complete"`.
- **`missingMembers`** (v16.98) — roster members of this `rosterType` the AI returned NO row for (advisory: could be a dropped row OR a genuine absence — leaver/new starter/other page). The review UI lists them so a silently-dropped member is visible.

### AI prompt key rules (do not weaken without testing)

- RDW cells: AI returns `"RDW HH:MM-HH:MM"` — **never strip RDW from the return value**
- Blank/absent Sunday cells: return `"RD"` — do not copy Monday's shift
- Duty/diagram codes on a second line (e.g. `"CEA 16"`) — **ignore entirely**, only the first line is the shift value
- `"N/A"`, `"NA"`, `"NS"` all mean RD on any day
- **`"HA"` (hospital appointment), `"OD"` (paid absence / long-term sick marking), `"SC"`/`"SN"` (sick), and `"ML"` (maternity leave, v17.19) → `"SICK"`** (v15.45; SC/SN/ML added later). On a base REST day the review normalises them to RD (never written; a stale imported one REMOVE_IMPORTs on re-upload) — full-pay absence only applies to rostered days. Sundays: blocked like all absence. A **Rest↔Absence cross-check disagreement** (one AI pass reads the absence code, the other blank) now **records the absence** rather than flagging UNREADABLE (v17.14, `applyColumnScanCrossCheck`) — dropping a real absence is the dangerous silent failure; the review message uses app language ("Absent", never "sick")
- `"AL"`, `"A/L"`, `"A.L."` all mean annual leave — return `"AL"`
- **Other family (v15.34; Team Day added v15.51, Union course added v18.56, Meeting added v18.61, OTHER_PLAN.md):** `"TRG"`/`"TRAINING"`/`"TRAIN"` → `"TRG"`; `"INDUCTION"`/`"IND"` → `"IND"`; `"ASSESSMENT(S)"`/`"ASSESS"` → `"ASSESS"`; `"TEAM DAY"`/`"TEAM DAYS"`/`"TEAM"` → `"TEAM"`; `"UNION COURSE"`/`"UNION"` → `"UNION"`; `"MTG"`/`"MEETING(S)"` → `"MEET"` ("Team Day" and "Union course" are the multi-word roster labels; "MTG" is the meeting code); an RDW marker either side (`"TRG RDW"`, `"RDW TRG"`) is preserved as the canonical `"FLAVOUR RDW"`. Saved as `type: 'other'` with the value verbatim. An Other cell WITH times is unexpected (rosters never set them) → UNREADABLE review row. **An Other day on a Sunday is invalid** — normalised to RD like AL/SICK
- **AL or Absent on a Sunday is invalid** — Sundays are non-contracted for all grades. The review pipeline (`computeCellStates`) normalises a Sunday `"AL"`/`"SICK"` to `"RD"`, so it classifies as MATCH and is never written as a Sunday annual-leave/absence override. A worked Sunday time stays RDW. Mirrors the in-app rule — see CLAUDE.md "Sundays are non-contracted".

### Review pipeline

```
parsedResult (from Cloud Function)
        ↓
computeCellStates(parsedResult, existingOverrides)
  — classifies each day:
    MATCH      = PDF matches base roster, nothing to do
    DIFF       = PDF differs from base roster, needs saving
    CONFLICT   = manual override already exists but differs from PDF
    COVERED    = manual override already matches PDF, nothing to do
    REMOVE_IMPORT = a stale previous PDF import whose day now matches base — approving
                 DELETES the stale doc and writes nothing (a fresh base-matching override
                 would be redundant and mask a future base-roster change) (v15.31)
    UNREADABLE = normaliseShift couldn't parse the cell (UNKNOWN| sentinel) — shown
                 skip-only, NEVER written; admin fixes the PDF or records it manually (v15.30)
        ↓
renderReviewTable() — per-person card list (presentation reworked v15.52):
  • plain-language OUTCOME SUMMARY above the list ("what Save will do")
  • each change row = a Save tick + action tag (Update / Clear old / Your choice / Not saved)
  • conflicts = inline "Keep yours / Use new roster" (was Manual / PDF); no separate banner
  • Save button shows a live count. State machine + `chosen` model UNCHANGED.
  shiftDisplay(shiftStr, baseShift)
    — detects "RDW|" prefix → shows 💼 RDW badge + time
    — falls back to baseShift==='RD' detection for plain times
        ↓
Apply approved changes:
  shiftValueToOverrideType(value, baseShift, date) → Firestore type field
    — date detects Sunday: worked times → 'rdw'; AL/SICK → 'correction' (RD) backstop
  Strip "RDW|" prefix → save plain time as value
  source: 'roster_import' on all saved docs
```

---

## Weekly Retail Circular and Marylebone Newsletter — full detail

### Overview

Two independent document-upload flows with identical mechanics: an admin uploads a PDF from the Operations page; staff access the latest document via the nav-panel drawer. Both are handled by the same helper pattern in `firebase-client.js`.

### Upload flow (admin, Operations page)

1. Admin opens the Operations page and expands the relevant card (Weekly Retail Circular or Marylebone Newsletter).
2. Selects an upload date using the date input (capped to today — `dateInput.max = formatISO(new Date())`).
3. Selects a PDF or Word (.docx) file and clicks **Upload**.
4. `uploadCircular(date, file, uploadedBy)` / `uploadNewsletter(date, file, uploadedBy)` in `firebase-client.js`:
   - Writes the file (PDF or Word .docx) to Firebase Storage at a versioned path: `circulars/{date}-{uploadId}.{ext}` / `newsletters/{date}-{uploadId}.{ext}` (the random suffix prevents overwriting the existing file before Firestore has committed the new doc)
   - Upserts the Firestore doc at `circulars/{date}` / `newsletters/{date}` with `{ date, storageUrl, storagePath, fileType: "pdf"|"docx", uploadedAt, uploadedBy }`; the `storagePath` field records the exact Storage path for cleanup tracking
   - After a successful Firestore upsert, deletes the previous Storage file at the old `storagePath` (if one existed)
   - Fire-and-forget: calls `_pruneOldDocs()` to delete documents and Storage files older than 6 months

Re-uploading for the same date overwrites the Firestore doc and replaces the Storage file; the old Storage file is deleted after the new Firestore doc commits. Docs uploaded before v13.99 lack a `storagePath` field — `_pruneOldDocs` falls back to `{collection}/{date}.pdf` for those.

### 6-month auto-prune

`_pruneOldDocs(collectionName, excludeDate, storage, refFn, deleteObject)` in `firebase-client.js`:
- Calculates a cutoff date 6 months in the past
- Queries the collection for docs with `date < cutoff`, then skips the just-uploaded `excludeDate`
- For each match (Firestore first, then Storage): `deleteDoc` then `deleteObject`. A Storage delete failure is logged via `console.warn` and never thrown; a Firestore delete failure is caught per-doc and logged via `console.error` so one bad delete can't abort the rest
- Called fire-and-forget at the end of both `uploadCircular` and `uploadNewsletter` — a failed prune never blocks the upload

### Staff access flow

1. Staff taps ☰ → **Weekly Retail Circular** or **Marylebone Newsletter** in the nav-panel drawer.
2. `nav-panel.js` click handler fires. A `_docFetching` boolean guard at module scope returns early if a fetch is already in-flight (tap-guard against rapid repeated taps).
3. `window.open('', '_blank')` is called **synchronously** in the same event tick as the click — this is required for Safari/iOS to allow the new tab. The blank tab is opened before any async work begins.
4. `getLatestCircular()` / `getLatestNewsletter()` is awaited:
   - On success with a `storageUrl`: `newTab.location.href = url` opens the file (a PDF previews in the tab by its own URL; a Word `.docx` is routed through Microsoft's Office Online viewer via `officeViewerUrl` (v16.45) so it renders with images instead of downloading — still no Mammoth-style inline HTML conversion, unlike the Huddle); `closePanelForNavigation()` closes the drawer.
   - On success with no document (null): `newTab.close()` cancels the blank tab; the coming-soon lightbox is shown.
   - On Firestore error: same as null — cancels the blank tab, shows a retry message in the coming-soon lightbox.
5. `_docFetching` is reset to `false` in `.finally()`.

### Security

| Operation | Requirement |
|-----------|-------------|
| Reads | Open — no auth required. `calendar-app.js` has no Firebase session (matches Huddle model). The download URL is a tokenised Firebase Storage URL; access to the Firestore metadata alone does not bypass Storage rules. |
| Writes | `request.auth.token.admin == true` (admin claim only) |
| Storage create/update | Rules enforce PDF or Word (.docx) MIME type + ≤20 MB per file (Word added v16.31) |
| Storage delete | Admin-only; MIME/size checks omitted (no `request.resource` on delete) |

### Firestore / Storage paths

| Resource | Path |
|----------|------|
| Circular Firestore doc | `circulars/{YYYY-MM-DD}` |
| Circular Storage file | `circulars/{YYYY-MM-DD}-{uploadId}.{ext}` (`ext` = pdf or docx; versioned suffix, added v13.99) |
| Newsletter Firestore doc | `newsletters/{YYYY-MM-DD}` |
| Newsletter Storage file | `newsletters/{YYYY-MM-DD}-{uploadId}.{ext}` (`ext` = pdf or docx; versioned suffix, added v13.99) |

---

## Firebase Auth — full detail (migration complete at v7.94)

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

`nameToEmail(name)` / `normaliseSurname()` in `auth-identity.js` (the pure browser module — re-exported by `firebase-client.js`, so importers may pull it from either) must stay in sync with the copy in `functions/roster-parse-helpers.js`. As of v12.04, `getSurname()` in `session.js` delegates to `normaliseSurname()`; since v16.50 the browser source is `auth-identity.js` (moved out of `firebase-client.js` so it is unit-testable). The derivation is duplicated in `functions/roster-parse-helpers.js` — intentional: Cloud Functions are CommonJS and cannot import browser ES modules. If the rule ever changes, update BOTH source files (`auth-identity.js` + `functions/roster-parse-helpers.js`); `surname-parity.test.mjs` enforces they match.

**Password derivation rule:** surname, lowercase, alphabetic characters only, **padded to a minimum of 6 characters by repeating the surname** (Firebase Auth's minimum password length). Surnames already ≥6 chars are used as-is; shorter ones are padded by repeating the surname cyclically (e.g. `"tuck"` → `"tucktu"`). The same derivation is used both on initial account setup and by `ensureFirebaseSession()` when it self-heals a missing account on page load. The single source for this padded default is `surnamePassword(fullName)` in `auth-identity.js` (v18.63).

**Chosen passwords (v18.63 — PASSWORD_PLAN.md Track C).** The surname value above is now only the **default** password. A member can set their own in Settings → Password, after which that secret is their real password and the surname no longer works for them. Sign-in tries the typed value first and only falls back to the surname default while the account is still on it (`credentialCandidatesFor` → `ensureFirebaseSession`). **Admin break-glass:** the `resetMemberPassword` Cloud Function (Operations → Account status → Reset) sets a member's Firebase Auth password back to `surnamePassword(name)` and (by default) revokes their refresh tokens, so a member who forgets a self-set password is recovered by the admin — there is no email-based self-service reset yet. Migration state (`passwordSetAt` vs `resetAt`) lives in the `passwordStatus` Firestore collection.

The `@myb-roster.local` domain is synthetic — not real email addresses. Firebase Auth accepts them as valid email format.

Migration history (v7.61 → v7.94) is in `ROADMAP.md` → Phase 2.
