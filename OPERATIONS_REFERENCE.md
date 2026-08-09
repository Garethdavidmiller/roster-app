# Operations Reference — MYB Roster App

*Last updated: August 2026 — v20.30 · Updated every 0.10 version*

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
                        conversions (> 200,000 characters — `MAX_HUDDLE_HTML_CHARS`). Viewer falls back to storageUrl if absent.
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
- **Cell layout is decided by CONTENT, never by line POSITION (v19.31 — this rule replaced the one that caused the AL bug).** A duty/diagram code (`"CEA 16"`, `"D24"`) is ignored *wherever it appears*; a status code (`AL`, `SPARE`, an absence code) is the cell's value *wherever it appears*, second line included. The retired wording was "duty codes sit on a second line — ignore them; only the first line is the shift value", which was true of a WORKED cell and false of every other one: on a non-worked day the second line holds the STATUS code, so that rule plus "blank = RD" composed into *discard the annual leave, see an empty first line, return RD*. It read most of the table perfectly and silently dropped leave and sickness — RD sits on that same second line and came out right by accident, which is why it hid. Pinned by `roster-prompt-parity.test.mjs`; do not reintroduce any line-position rule
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
    UNREADABLE = normaliseShift couldn't parse the cell (UNKNOWN| sentinel). Written ONLY
                 if the admin picks one of the server's two candidate readings on the row
                 (v19.32); with no pick it stays skip-only and writes nothing, exactly as
                 before. A pick is offered only when the two candidates survive normalisation
                 as DIFFERENT values — a pair that both collapse to RD is not a question with
                 one answer. No candidates (or a bad PDF) → fix the PDF or record it manually (v15.30)
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

**Chosen passwords (v18.63 — PASSWORD_PLAN.md Track C).** The surname value above is now only the **default** password. A member can set their own in Settings → Password, after which that secret is their real password and the surname no longer works for them. Sign-in tries the typed value first and only falls back to the surname default while the account is still on it (`credentialCandidatesFor` → `ensureFirebaseSession`). **Admin break-glass:** the `resetMemberPassword` Cloud Function (Operations → Account status → Reset) sets a member's Firebase Auth password back to the surname default (`nameToPassword(member)` — the CommonJS functions-side twin of the browser's `surnamePassword`, kept equal by `surname-parity.test.mjs`) and (by default) revokes their refresh tokens, so a member who forgets a self-set password is recovered by the admin — there is no email-based self-service reset yet. Migration state (`passwordSetAt` vs `resetAt`) lives in the `passwordStatus` Firestore collection.

### Locked-out member → reset request queue (v18.93–95)

The one flow that starts with **no identity at all**: a member who has forgotten a self-set password
has no Firebase session, so they cannot write anything — which is why this runs through the app's only
public unauthenticated endpoint rather than a client write.

1. **Member** taps "Can't get in?" on the login overlay → `requestPasswordReset` in
   `firebase-client.js` (the one caller there that sends **no** auth token) → the
   `requestPasswordReset` Cloud Function.
2. **Function** (Admin SDK) upserts `resetRequests/{memberName}` — `requestedAt`, `count`, and
   `provisioned` (false ⇒ the remedy is **Set up accounts**, not Reset). The doc ID is the member
   name *deliberately*: the collection can never exceed the roster size, so flooding it is impossible
   by construction rather than by rate limiting. The name comes from the server-owned `activeMembers`
   list, never the request body, and **no free text is ever stored** — an unauthenticated endpoint
   writing caller-controlled strings into an admin UI would be an injection surface for no benefit.
3. **Admin push** — a genuinely-recorded request (never a throttled repeat) sends
   `🙋 Reset requests — N waiting` via `sendTargetedPush`, **not** `fanOutPush`: "N. Surname is locked
   out" broadcast to ~50 staff would be a leak. Owner-uid filtered, fails closed at every step, no
   fall-back-to-everyone branch. Deep-links to `operations.html#reset-requests`, which opens and
   scrolls to that card (`DEEP_LINK_CARDS`). The push is a courtesy — the Firestore row is the doorbell.
4. **Admin** actions it in Operations → Password Reset Requests (Reset, or Set up accounts if
   `provisioned` is false), then clears the row (`clearResetRequest`). Create/update is denied to every
   client **including the admin**; only the function writes.

**Accepted cost:** an admin device that subscribed to push before v17.76 (when `owner` was first
stamped on subscriptions) gets no notification until the bell is toggled off and on.

### Sign-in statistics (v18.96)

The Operations → Usage card shows an **exact** unique-account count beside the anonymous trend. It
comes from `getSignInStats` (admin-only), which reads Firebase Auth's own `lastSignInTime` — so
uniqueness is a property of the data rather than something the app has to enforce, and nothing new is
stored. Filtered to an allowlist of the current server-owned roster so an un-swept leaver cannot
inflate it; returns four integers, no identity. It measures **sign-ins, not activity** (sessions last
30 days absolute / 7 idle, so most page opens are session *restores*), and there is no history — only
the last sign-in is stored. `neverSignedIn` is the actionable figure.

### Which address staff are on (v19.23, key added v19.29)

While the app is served from BOTH `myb-roster.web.app` and the GitHub Pages mirror, the Usage card's
**Which address staff are on** section is the only record of how far the move has got. Unique accounts
per address over the last 30 days, with the share that opened the **installed app** rather than a
browser tab nested inside each bar. Each row names its full address underneath — the labels alone are
too short to identify (v19.29, after the labels were shortened for column alignment and the addresses
were left in a hover tooltip no phone can reach).

**Read it knowing what it cannot see.** It counts OPENS, so an install nobody has opened in 30 days is
invisible — and those are exactly the people a migration strands. Someone using both addresses counts
on each, which is what half-migrated looks like. Admin loads are excluded, like every other figure on
the card.

**Why it matters operationally:** an installed PWA keeps launching from its own service-worker cache,
so it will not drift onto the new address by itself. Anyone who does move loses their pay calculator
data unless they carry it across first (paycalc → Move Your Pay Data), because localStorage is
per-origin. The counters are how you tell whether that has happened yet.

The `@myb-roster.local` domain is synthetic — not real email addresses. Firebase Auth accepts them as valid email format.

Migration history (v7.61 → v7.94) is in `ROADMAP_HISTORY.md` → Completed phases.

---

## Staff PIN access for the Calendar (v20.12)

The Calendar opens for **either** a signed-in member **or** the shared staff PIN. Everything
privileged — Admin, Settings, Operations, Links — still needs a real member sign-in; the PIN grants
one capability and one only: *read the Calendar's override data*.

### Why it exists

Staff open the roster on shared office PCs for a quick look. Signing into a corporate Windows
account gives them a fresh browser every time, so a full member sign-in for a thirty-second glance
is friction nobody would accept. Until v20.12 the alternative was that override data — annual leave,
absence and shift changes for every member — was readable by anyone with the URL. The PIN is what
lets both be fixed at once.

### What a member experiences

| Situation | What happens |
|---|---|
| Signed-in member, live session | Nothing changes. No PIN, no interruption; the 30-day / 7-day-idle session rules are untouched. |
| Shared PC, fresh browser | The Calendar area shows a small "Enter the staff PIN" card. Four digits → the roster, including whichever member was last selected on that machine. |
| Same browser, reload or navigation | Stays unlocked. The viewer session lives as long as the browser session. |
| Browser closed and reopened | The PIN is asked for again. That is the point — a PC left on a Windows account does not carry the roster into the next person's day. |
| Guides, Huddle, Circular, Newsletter | Reachable **without** the PIN. The nav drawer is never locked. |

A member on a shared PC can also use **"Sign in instead"** on the unlock card, and a viewer can
press **Lock Calendar** in the nav drawer before walking away.

### Switching it on and off

`CONFIG.CALENDAR_PIN_ACCESS` in `roster-data.js` is the on/off switch, and both directions are a
hosting deploy of one line:

- **`false`** — the Calendar is on its pre-v20.12 model: anonymous session, no gate, no card. Staff
  see no change at all. This is how the feature ships DARK, and it is the fast rollback while the
  `overrides` rule is still permissive.
- **`true`** — the card is up: a member session or the staff PIN, and nothing else.

**It controls friction, not protection.** Whether the roster is actually protected is decided by
`firestore.rules`, which is a separate deploy. Once the rules are tightened, switching the flag off
no longer re-opens anything — the client stops asking for a PIN while the server keeps refusing the
reads, which shows every visitor a base roster under a "couldn't update" chip. Rolling back after
that point means rolling back the rules: RECOVERY_RUNBOOK.md → "The Calendar PIN".

**As shipped (v20.17) the flag is `false` and the `overrides` read rule carries a matching
`allow read;` hold line**, so the whole feature is deployed and dormant. Releasing the two brakes in
order — client first, rules second, one push each — is steps 3 and 4 of the rollout in
RECOVERY_RUNBOOK.md → "The Calendar PIN". Do not release them in one push: the deploy workflows run
in parallel, so which lands first is a coin toss, and the wrong order is the state that shows every
staff phone a roster that is wrong rather than obviously broken.

### Setting the PIN (do this FIRST — the function will not work without it)

The value lives only in Secret Manager. It is deliberately **not** in the repository, in any
documentation, in any test, or in any client asset.

```
firebase functions:secrets:set CALENDAR_VIEWER_PIN
# paste the four digits when prompted, then redeploy the function so it picks the version up:
firebase deploy --only functions:unlockCalendarViewer
```

### Rotating the Calendar PIN

No client release is needed — the client never knows the value.

1. `firebase functions:secrets:set CALENDAR_VIEWER_PIN` (enter the new value).
2. Redeploy the bound function so it picks up the new secret version:
   `firebase deploy --only functions:unlockCalendarViewer`.
3. Tell staff the new code.

New unlock attempts use the new PIN immediately. **Sessions already unlocked are not affected** —
they hold a Firebase token, not the PIN. If you need to invalidate those too (someone left, the code
got out), also revoke the shared account's refresh tokens:

```
# Google Cloud Shell, or anywhere with the Admin SDK and project credentials:
firebase auth:export /tmp/u.json --project myb-roster    # (optional, to confirm the uid exists)
# then, in a Node shell with firebase-admin initialised:
await admin.auth().revokeRefreshTokens('calendar-viewer')
```

Every viewer session is then rejected on its next token refresh (within the hour) and must re-enter
the new PIN. Member sessions are untouched.

### How it works

1. The browser POSTs `{ pin }` to `unlockCalendarViewer` (europe-west2). CORS is restricted to the
   app's own hosting origins; the PIN is compared **server-side**, in constant time, against the
   `CALENDAR_VIEWER_PIN` secret. Nothing is compared in the browser and no verifier is shipped to it.
2. On success the function ensures a dedicated Firebase Auth account (`calendar-viewer`, **no
   email**), re-applies its claims — exactly `{ calendarViewer: true }` — and returns a custom token.
3. The client switches Firebase Auth to **session-only persistence**, signs in with the token, and
   verifies the claim actually arrived before showing anything.
4. `firestore.rules` allows `overrides` reads for a `name` claim (a real member) or `calendarViewer`.
   The viewer can write nothing, anywhere.

### Abuse protection

A four-digit PIN is 10,000 combinations, so the endpoint is throttled server-side **two ways**, both
recorded in the server-only `viewerAttempts` collection. Only *failures* are recorded — a correct
PIN writes nothing.

1. **Per source — 30 failed attempts per 15 minutes, then a 15-minute block.** Sized for a station
   behind one corporate NAT address: thirty *wrong* entries in fifteen minutes from the whole
   building is not fumbling, and a correct PIN never counts.
2. **All sources — 200 failed attempts per 15 minutes** (v20.35), under a fixed key. This caps the
   whole endpoint at 800 guesses an hour, so the full PIN space takes upwards of twelve hours of
   obviously abnormal traffic.

**Why the second one exists.** Every per-source limit depends on identifying the caller, and that
identification comes from the `x-forwarded-for` header — which a caller can *prepend to*. Until
v20.35 the code read the **first** entry, so sending a different fake address per request minted a
fresh bucket each time and there was no effective limit at all. The key is now taken from the **end**
of the chain (the platform appends; a caller cannot), and the all-sources ceiling holds regardless,
because it is keyed on a constant no header can touch.

Blocks expire on their own; there is no permanent lock, deliberately, because a shared-source
control that anyone can drive into a permanent state is a denial-of-service handle pointed at staff.
If the all-sources ceiling ever *does* trip during normal use, that means the code in circulation is
wrong — reissue it rather than raising the number.

### Diagnosing a problem

- **"PIN not recognised" for everybody** → the secret is unset or was changed without redeploying
  the function. Check `firebase functions:secrets:access CALENDAR_VIEWER_PIN` and redeploy.
- **"Calendar access is not configured" (503)** → the secret is genuinely missing.
- **Unlock succeeds, Calendar shows no shifts** → the token minted without its claim, or the rules
  and the client disagree about the claim name. `calendar-viewer-parity.test.mjs` is the guard for
  the second; the Cloud Function log line `[unlockCalendarViewer] unlocked <hash>` confirms the first.
- **Nothing in the Operations Error Log** → expected. A locked Calendar has no Firebase identity, so
  it cannot write client errors. Use the Cloud Function logs.
