# Operations Reference — MYB Roster App

*Last updated: November 2026 — v25.90 · Updated every 0.10 version*

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
reclaims those as orphans — see Auto-prune below.)

**Storage URL strategy:** `ingestHuddle` writes a permanent `firebaseStorageDownloadTokens`
download URL to `storageUrl`. It does NOT use a signed URL for the stored link — GCS caps v4
signed-URL expiry at 7 days, far shorter than the 3-month Huddle retention window. Members open the
file through a 15-minute signed link from `getDocumentUrl` when one can be minted, with the stored
URL as the fallback (AUTH_PLAN.md §5).

Download-token URL format (`ingestHuddle` always writes this — it never stores a signed URL):
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD-{uploadId}.pdf?alt=media&token={uuid}
```

**Auto-prune (3 months):** at the end of every `ingestHuddle` run, `pruneOldHuddles()`
(`functions/huddle-retention.js`) deletes huddle Firestore docs *and* their Storage objects older
than 3 months (`HUDDLE_RETENTION_MONTHS`).
**It deletes only what it selected (v25.89):** each document is re-read in a transaction and left
alone if a replacement has moved its `storagePath`, then only that version's object is deleted, by
name. Other objects under `huddles/<date>` — legacy fixed paths, and versions a failed read left
behind — are reclaimed by `sweepHuddleOrphans` only when they are over a day old and no live document
names them (the race this closes is in that module's header). It is awaited (so it runs before Cloud
Run reclaims the container) but best-effort — failures are swallowed and never block the upload
response. Circulars/newsletters keep 6 months; huddles are higher-volume and rarely referenced after
the day, so retention is shorter.

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle). The fields are **`docs/DATA_MODEL.md` →
huddles**, which is their one home. Two operational points: `uploadedBy` is `"power-automate"` for the
Cloud Function and a member name for a manual admin upload; and `htmlContent` (DOCX converted to HTML
by mammoth.js at upload time) is absent for PDFs, for a conversion longer than `MAX_HUDDLE_HTML_CHARS`
(200,000 characters), and for a Word file that was not converted: one Power Automate sends over 2 MB
(`MAX_DOCX_CONVERT_BYTES` in `functions/documents.js`), or one whose conversion failed. The viewer then
falls back to the file.

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

**A 500 does not always mean nothing was stored.** A record write can land and its answer be lost.
The function then reads the record back, and finding its own upload there it finishes as usual:
stored, announced, 200. Only if Firestore stays unreachable through the write's retries and that read
too does it answer 500 with the Huddle possibly in the app — and nobody told, because Power Automate's
retry finds the flow's own record and stays silent as a re-send (`functions/documents.js`).

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

**Priority:** DOCX is preferred — it converts to HTML server-side and renders inline in the app. PDF is the fallback if no DOCX attachment is present. The choice is an attachment-type check, never a time-of-day condition.

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

Access posture: **read requires access, write admin-only** — a read needs a bound member identity,
the admin claim, or the staff-PIN viewer capability. The live rule in `firestore.rules` is the
authority — it also shape-validates browser writes: `hasOnly` field allowlist, bounded `YYYY-MM-DD`
date, `fileType in ['pdf','docx']`, typed `uploadedAt`/`uploadedBy`, a 250,000-char `htmlContent` cap,
and a separate admin-only delete rule. Don't quote the rule here — it drifts; read the file.

Reads need access because the three documents are behind the PIN or a password (owner decision,
7 Sep 2026): a notification tap on a locked device is held on the PIN card, and the client refuses
the read at source (`calendar-doc-access.js`) — see "Behind the PIN" below. Browser writes (the
manual admin upload path in `huddle.js`) require the admin claim; the automated `ingestHuddle` Cloud
Function uses the Admin SDK, which bypasses rules entirely. The matching Storage rule (`storage.rules`)
also requires the admin claim for huddle file writes.

### Huddle notification tap behaviour

When a push notification is tapped, the service worker (`notificationclick` handler) **re-bases the payload's route onto its OWN scope** (`registration.scope`) and opens it via `focusedClient.navigate()` or `clients.openWindow()` — e.g. `https://myb-roster.web.app/#huddle` on a Firebase Hosting install (or `https://garethdavidmiller.github.io/roster-app/#huddle` on the GitHub Pages mirror). It deliberately ignores the payload's origin: the Cloud Function sets one `STAFF_SITE_URL` (the canonical `https://myb-roster.web.app`), but installs live on different origins/paths, so only the payload's trailing page + hash are used and the origin is taken from the SW's own scope. Never fall back to the bare origin — that was the cause of the 16 Jun 2026 notification 404. On load — or via the `hashchange` listener if the page is already open — `calendar-huddle-viewer.js` fires `_triggerAutoOpen(huddle)`. The nav-panel **Daily Huddle** link points at the same `#huddle` hash, so it runs the identical path; there is no separate button trigger.

**The Huddle is not printed (owner decision, 7 Sep 2026).** Printing while the viewer is open gives a
short notice, not the day plan — the Huddle is read in the app and replaced daily, and the viewer is
`position: fixed` over a scrolling body, so a long plan would reach paper truncated with nothing saying
the rest existed. Closing the viewer prints the calendar as normal. This governs what the APP puts on
paper — a PDF Huddle opens in the browser's own PDF viewer and can be printed from there like any file.

**Two render paths inside `_triggerAutoOpen` — do not unify:**

| `htmlContent` | Behaviour (identical for the nav-panel link and a notification tap) |
|---------------|--------------------------------------------------------------------|
| Present (DOCX converted server-side) | Renders sanitised HTML inline in the viewer overlay |
| Absent (PDF, or DOCX conversion failed) | Shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); tapping it calls `window.open(url, '_blank', 'noopener')` with the short-lived `getDocumentUrl` URL minted when the button was drawn — or the stored `storageUrl` if none has arrived by the tap, or if the signed one names a different file than this Huddle's `storagePath` (an upload landed between the two reads) |

**Why the in-overlay button (no `htmlContent`):**

A notification tap provides no transient user activation in the page. This means:
- `window.open('_blank', ...)` → pop-up blocked by the browser (no user gesture)
- `window.location.href = storageUrl` → navigates the standalone PWA's top-level window to a cross-origin URL; Android wraps the app in browser chrome and the standalone window is lost

Tapping the in-overlay "📄 Open Huddle" button IS a real user gesture. `window.open(url, '_blank', 'noopener')` then opens the file as an Android Custom Tab overlaid on top of the intact standalone PWA. The Android Back gesture dismisses the Custom Tab and returns directly to the clean standalone app.

**Important:** Both triggers (nav-panel link and notification tap) reach the viewer through the `#huddle` hash and the single `_triggerAutoOpen` path, so the no-`htmlContent` case always opens the file via the in-overlay button — never a direct `window.open`/`location.href` at open time. Routing both triggers through the explicit button avoids relying on activation that may not be present. DOCX files with `htmlContent` bypass this entirely — they render inline.

**Behind the PIN (owner decision, 7 Sep 2026).** The notification itself cannot break — it is built server-side and carries no document content — but the TAP-THROUGH needs access: the viewers consult `calendar-doc-access.js`, which the Calendar opens on the full grant. A tap on a device that is signed in or holds a viewer session opens the Huddle as before. A tap on a device that is locked lands on the PIN card with the tap HELD: entering the PIN (or signing in) finishes it and the Huddle opens. No read — cached or live — is issued while locked, which is what a rules change alone could not guarantee. The rules closing the three collections' reads shipped one release after the client: a read-tightening ships client-first, the reverse of a schema expansion.

**Push notifications paused?** If `HUDDLE_PUSH_PAUSED` is `true` in `functions/documents.js`, Huddle ingestion succeeds but no push is sent. To re-enable: set it back to `false`, redeploy Functions, and verify `STAFF_SITE_URL` (`functions/index.js`) is the bare `https://myb-roster.web.app` origin — the service worker discards the payload origin/path and re-bases only the trailing page/hash onto its own `registration.scope`, so no `/roster-app` sub-path is needed.

---

## Weekly Roster Upload — full detail

### Cloud Function — `parseRosterPDF`

**The parse's contract — every defence against a week written onto the wrong days, what a blank cell
means, the review's states and controls — is `.claude/rules/roster-import.md`. Read it before changing
anything in the import.** This section is the request/response reference and the review pipeline.

- **Region:** `europe-west2` (London)
- **Auth:** Firebase ID token — browser sends `Authorization: Bearer <idToken>` where idToken comes from `auth.currentUser.getIdToken()`. The function validates it via the Firebase Admin SDK and requires the admin custom claim, as `setupRosterAuth` does. There is no shared roster secret.
- **CORS:** `cors: ADMIN_FUNCTION_ORIGINS` — an explicit origin allowlist (`functions/index.js`): `https://garethdavidmiller.github.io`, `https://myb-roster.web.app`, `https://myb-roster.firebaseapp.com`. This is defence-in-depth; the real control is the Firebase ID token + admin claim, so a browser from an unlisted origin is blocked at preflight *and* would fail auth. Add any new hosting domain to the `ADMIN_FUNCTION_ORIGINS` array. (`ingestHuddle` keeps `cors: false` — server-to-server.)
- **AI model and settings:** `MODEL_REQUEST` in `functions/roster-prompt.js` — which model, how it may think, `max_tokens` — sent as one non-streaming `messages.create` through `@anthropic-ai/sdk`, `timeoutSeconds: 120`. Its header holds the reasoning: why thinking stays off as far as the model allows (it spends `max_tokens`, and truncated the roster JSON into "The AI returned an unreadable response"), why the model ID is complete as written, and why a newer API version is a migration rather than a dependency bump. `index-endpoints.test.mjs` pins the request shape through the real handler, and a decline (`stop_reason: 'refusal'`) is reported as a decline (`DECLINED_ERROR`) rather than as an unreadable answer to retry. **Re-enabling thinking through streaming failed in production** (v16.27, "Couldn't read the roster — unexpected error", rolled back at v16.28); day-column accuracy is protected by the server-side defences instead, which do not depend on the model.
- **The defences, in one line each** (the contract is `.claude/rules/roster-import.md`): `applySundayScanCorrections` (the Sunday-anchored repair) and `applyColumnScanCrossCheck` (a second, column-by-column read cross-checked cell by cell) on the server; `assessRosterAlignment` (`roster-alignment.js`) on the client, which correlates each parsed week against the member's own base roster and REFUSES the whole read when three or more members drift the same way; and the PDF's own drawn grid (`functions/roster-geometry.js`), which refuses any AI day landing in a physically EMPTY cell. Before any of them, the sheet's own printed week (`functions/roster-week-heading.js`): a PDF whose `Week Ending: DD/MM/YYYY` heading names a Saturday other than `X-Week-Ending` is refused whole, before anything is written. **The row read and `columnScan` are not independent witnesses** — two readings by one model of one PDF in one call — which is why the alignment check compares against something the PDF cannot influence, and why the grid is the strong witness. When the grid places every member, the cells are extracted by coordinate and the model only normalises them (`buildCellTable`) — it never assigns a day and is sent no PDF; one unplaced name falls the whole document back to the PDF path.
- **Why direct PDF input (the fallback path):** Text extraction (pdf-parse) destroys table column structure and causes day-column misalignment. Claude reads the visual layout directly.

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
  "weekEnding": "2026-04-04",
  "rosterType": "cea",
  "dates": ["2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"],
  "crossCheck": "complete",
  "missingMembers": [],
  "duplicateMembers": [],
  "choices": {},
  "geometry": { "status": "complete", "checked": 28, "total": 28, "pagesRead": 2, "pagesRejected": 0 },
  "geometryRefused": [],
  "parsed": [
    {
      "memberName": "G. Miller",
      "shifts": {
        "2026-03-29": "RD",
        "2026-03-30": "RD",
        "2026-03-31": "06:00-14:00",
        "2026-04-01": "RDW|14:30-22:00"
      }
    }
  ]
}
```

- **`crossCheck`** — the column-scan cross-check status: `"complete"` (every returned member re-verified against a SECOND column-by-column read — by the same model, of the same PDF, in the same call, so it is a second reading and **not** an independent witness), `"partial"` (some), `"unavailable"` (the AI omitted/garbled `columnScan` so the check never ran), or `"not-applicable"` on the geometry path (that prompt asks for no column re-read). The review UI shows an advisory note when it isn't `"complete"` or `"not-applicable"`.
- **`missingMembers`** — roster members of this `rosterType` the AI returned NO row for (advisory: could be a dropped row OR a genuine absence — leaver/new starter/other page). The review UI lists them so a silently-dropped member is visible.
- **`duplicateMembers`** — roster members of this `rosterType` the AI returned MORE THAN ONE row for, judged against the same names as `missingMembers` (`repeatedMembers`, `functions/roster-prompt.js`). Only one row is used, the first that is not empty (`memberRows`; a real Dispatch sheet prints an empty placeholder row above the member's real one), so the review gives each member a line asking the admin to check them against the PDF. A response without the field, from an older Function, is read as none.
- **`choices`** — the two candidate readings for each cell the cross-check flagged, keyed `"memberName|date"`, so the review can offer a pick instead of a dead "couldn't read" row.
- **`geometry`** — `{ status, checked, total, pagesRead, pagesRejected }` for the PDF's-own-grid witness (`functions/roster-geometry.js`): `status` is `"complete"` (every returned member was matched to a geometry row and checked), `"partial"` (some — the rest are named in the Functions log as unmatched) or `"unavailable"` (no grid found, no text layer, `pdfjs-dist` absent, or nobody matched — the witness did not run for this read). Unlike `crossCheck`, this IS an independent witness: it reads the file's coordinates, not the model. It is counted over the rows the admin will see, never a hallucinated name.
- **`geometryRefused`** — the member names whose rows the witness refused (a claim read where the PDF's cell is empty), filtered to names on the review. Consumed by `assessRosterAlignment` (roster-alignment.js): such a row starts unticked with its own wording, and refusals count toward the three-member breaker. The refused cells themselves are already `UNKNOWN|…` in `parsed`.
- **A sheet for another week** — `409 { "error": "This roster is for the week ending Saturday 12 September 2026, but the week chosen is Saturday 5 September 2026. Choose the matching week and upload it again.", "sheetWeekEnding": "2026-09-12" }`, which the upload page shows after "Couldn't read the roster:". A PDF printing two different weeks is refused with "Upload one week's roster at a time." No heading read (no text layer, another layout, a date that is not a Saturday) refuses nothing: the Functions log says "the sheet's own week was not checked: …".

### What the roster codes mean (do not weaken without testing)

The code table the model is given is `SHIFT_VOCABULARY` in `functions/roster-prompt.js` — the ONE copy
both prompts interpolate, held to `normaliseShift` in both directions by `roster-prompt-parity.test.mjs`.
In one line each (the reasoning is `.claude/rules/roster-import.md`):

- **RDW cells:** the AI returns `"RDW HH:MM-HH:MM"` — **never strip RDW from the return value**.
- **`AL`, `A/L`, `A.L.`** → `"AL"`. **`SP` / `SPARE`** → `"SPARE"`. **`OFF`** (CES and bilingual rosters) → `"RD"`.
- **Absence:** `SC` (sick on a day the person WAS booked to work), `HA` (hospital appointment), `OD` (paid absence / long-term sick marking), `ML` (maternity leave) and `CL` (compassionate leave) → `"SICK"`, which the app calls Absent. **`SN` is NOT the same code as `SC`**: sickness on a day the person was NOT booked to work, so the day is the rest day it already was → `"RD"` (owner, Sep 2026).
- **`NA` / `N/A` and `NS`** (not available) → **a rest day, on every day, Sundays included** (owner, 6 Nov 2026). Weeks imported between 24 Sep and 6 Nov 2026 hold their NA days as Absent; nothing stored says which absences those were, so they change only when that week's roster is uploaded again.
- **The Other family** (OTHER_DAYS.md): `TRG`/`TRAINING`/`TRAIN` → `"TRG"`; `INDUCTION`/`IND` → `"IND"`; `ASSESSMENT(S)`/`ASSESS` → `"ASSESS"`; `TEAM DAY`/`TEAM` → `"TEAM"`; `UNION COURSE`/`UNION` → `"UNION"`; `MTG`/`MEETING` → `"MEET"`; an RDW marker either side is preserved as the canonical `"FLAVOUR RDW"`. Saved as `type: 'other'` with the value verbatim. **A meeting is always a meeting**, and keeps printed times in either order (`"10:00-14:00 MTG"` → `"MEET 10:00-14:00"`); a meeting cell it cannot read cleanly goes to review, never to a plain shift. Any other Other cell WITH times goes to review when the code comes first; written time-first it still imports as a plain shift — a known gap. **A training or meeting day on a Sunday is never recorded** (a GUARDED row); one printed WITH times is rest-day working at those times.
- **Cell layout is decided by CONTENT, never by line POSITION.** A duty/diagram code (`"CEA 16"`, `"D24"`) is ignored *wherever it appears*; a status code (`AL`, `SPARE`, an absence code) is the cell's value *wherever it appears*, second line included. A line-position rule ("only the first line is the shift value") once silently discarded annual leave, because on a non-worked day the second line holds the STATUS code. Pinned by `roster-prompt-parity.test.mjs`; do not reintroduce any line-position rule.
- **A blank cell means different things on different days.** A blank or absent Sunday is `RD`, never a copy of Monday's shift (Sunday is uncontracted and the sheets leave a non-working Sunday empty). **Mon–Sat is the opposite**: the rosters state an unworked weekday explicitly, so a blank there is a cell nobody read and becomes an UNREADABLE review row rather than a silent rest day. Expect a handful where a member appears on TWO rosters and works only part of the week on the second — defaulting them to RD would write rest days over the shifts the other roster's import had just recorded. If the roster office puts explicit `RD`s in those cells, the rows go away. On a row whose Monday to Saturday were all unread, the Sunday is a question too (whole-app fix, Nov 2026).
- **A worked Sunday does NOT carry an RDW marker, and must never be treated as suspicious for lacking one.** RDW means *a rest day being worked*; Sunday is uncontracted, so its work is inherently overtime and the sheet never labels it.
- **A code that is not in the table is never read as a rest day** — it reaches the admin as an UNREADABLE review row carrying the raw text.
- **Leave, an absence or an Other day on a Sunday is never recorded, and leave or an absence on a base REST day is recorded only when the admin answers that it was a swapped working day** — both arrive as GUARDED rows (below), never silently. Full-pay absence applies only to rostered days. Mirrors the in-app rule — CLAUDE.md "Sundays are non-contracted".

### Review pipeline

```
parsedResult (from Cloud Function)
        ↓
computeCellStates(parsedResult, existingOverrides)
  — roster-review-states.js (re-exported by admin-roster-upload.js). Classifies each day:
    MATCH         = PDF matches base roster, nothing to do (not shown)
    DIFF          = PDF differs from base roster (a weekday RDW at the base shift's own hours included)
                    — pre-ticked to save, except on 25 and 26 December from 2026, which start unticked
                    with a note that the app's Christmas leave decides them
    CONFLICT      = a manual override already exists but differs from PDF — "Keep saved" (the default,
                    writes nothing) or "Use new roster"
    COVERED       = an override already matches PDF, nothing to do
    REMOVE_IMPORT = a stale previous PDF import whose day now matches base — approving DELETES the
                    stale doc and writes nothing (a fresh base-matching override would be redundant
                    and mask a future base-roster change)
    GUARDED       = the PDF said something the app's rules refuse to record on that day — leave or an
                    absence on a base REST day, anything on a Sunday, a training or meeting day on a
                    Sunday. Shown and explained, never silently dropped. Leave or an absence on a rest
                    day ASKS "Was it a swapped working day?": only "Swapped — record it" writes (stamped
                    `replacedType`); "Rest day — leave it" writes nothing and clears an earlier record
                    on that day; unanswered writes nothing. "Skip all" takes an answer back. On 25 and
                    26 December from 2026 nothing is asked: the app's Christmas leave decides those
                    days, and an earlier import there is offered as an unticked "Clear old"
    UNREADABLE    = normaliseShift couldn't parse the cell (UNKNOWN| sentinel). Answered on the row:
                    (a) pick one of the server's two candidate readings (`choices`), offered only when
                    they survive normalisation as DIFFERENT values and neither is leave or an absence
                    on a base rest day (such a cell offers no picks; its entry asks the swapped-day
                    question); a rest day picked or entered over a base rest day writes nothing new,
                    only clearing what the day held; (b) ENTER the shift — type pills
                    generated from `PILL_TYPES` (Other included, with the week editor's flavour chips)
                    plus 24-hour HH:MM boxes (`roster-entry-control.js`), composed through
                    `manualCellValue` and then the SAME `normaliseCellValue` guards every parsed value
                    passes; (c) leave it, which is the default and writes nothing. Real rosters carry
                    cells like `SEE NATHAN`, which no parser will ever resolve — that is what (b) is for
    A member whose rows look a day out starts UNTICKED; three drifting the same way refuse the whole read.
        ↓
renderReviewTable() — per-person card list:
  • plain-language OUTCOME SUMMARY above the list ("what Save will do")
  • each change row = a Save tick + an action tag saying what Save will do with it
  • the ORIGINAL PDF stays reachable from the review — every message on this page ends in "check it
    against the PDF". It is a DOWNLOAD, not a new tab: a blob: document inherits the creating page's
    CSP, and the app's `object-src 'none'` blocks Chrome's plugin-backed PDF viewer, so a preview
    would open a blank frame. The object URL is created at CLICK time (so it cannot go stale) and
    revoked on a timer (an immediate revoke cancels the download on Android)
  shiftDisplay(shiftStr, date)
    — "RDW|" prefix → 💼 RDW badge + time; a timed Sunday → RDW (Sundays are uncontracted)
    — an Other day shows its RDW marker and times beside the badge
    — an UNKNOWN| value → "couldn't read …"
        ↓
Apply approved changes:
  shiftValueToOverrideType(value, date) → Firestore type field (roster-cell-rules.js)
    — date detects Sunday: worked times → 'rdw'; AL/SICK → 'correction' (RD) backstop
  Strip "RDW|" prefix → save plain time as value
  source: 'roster_import' on all saved docs
```

---

## Weekly Retail Circular and Marylebone Newsletter — full detail

### Overview

Two independent document-upload flows with identical mechanics: an admin uploads a PDF from the Operations page; staff access the latest document via the nav-panel drawer. Both are handled by the same upload engine in `documents-client.js` (`firebase-client.js` re-exports the entry points).

### Upload flow (admin, Operations page)

1. Admin opens the Operations page and expands the relevant card (Weekly Retail Circular or Marylebone Newsletter).
2. Selects an upload date using the date input (capped to today; the shared `doc-upload.js` card takes a `maxDateOffsetDays`, which only the Huddle's sets, to tomorrow).
3. Selects a PDF or Word (.docx) file and clicks **Upload**.
4. `uploadCircular(date, file, uploadedBy)` / `uploadNewsletter(date, file, uploadedBy)` — exported from `firebase-client.js`, implemented in `documents-client.js`:
   - Writes the file (PDF or Word .docx) to Firebase Storage at a versioned path: `circulars/{date}-{uploadId}.{ext}` / `newsletters/{date}-{uploadId}.{ext}` (the random suffix prevents overwriting the existing file before Firestore has committed the new doc)
   - Upserts the Firestore doc at `circulars/{date}` / `newsletters/{date}` with `{ date, storageUrl, storagePath, fileType: "pdf"|"docx", uploadedAt, uploadedBy }`; the `storagePath` field records the exact Storage path for cleanup tracking
   - After a successful Firestore upsert, deletes the previous Storage file at the old `storagePath` (if one existed)
   - Fire-and-forget: calls `pruneOldDocs()` (`doc-retention.js`) to delete documents and Storage files older than 6 months

Re-uploading for the same date overwrites the Firestore doc and replaces the Storage file; the old Storage file is deleted after the new Firestore doc commits. Docs uploaded before v13.99 lack a `storagePath` field — `pruneOldDocs` falls back (via `legacyDocPath`) to `{collection}/{date}.{fileType}` for those, honouring the OLD doc's own `fileType` so a PDF↔DOCX swap still finds the previous file.

### 6-month auto-prune

`pruneOldDocs(collectionName, excludeDate, storage, refFn, deleteObject, fs)` in **`doc-retention.js`**
(`fs` is the injected Firestore handle set, which is what lets the sweep be driven against fakes in
Node). It is the browser's only destructive operation on shared data, so check `doc-retention.js`
before relying on this summary:

- **Reads a SERVER time first** and skips the whole sweep if it cannot get one. The just-written
  anchor document carries `uploadedAt: serverTimestamp()`, so reading it back costs one read. Never a
  client clock: a destructive delete driven by whichever admin device happened to upload would let a
  clock running months fast take months of current documents. No server time → no sweep,
  deliberately: retention is housekeeping and the next upload runs it again.
- Derives the month-underflow-safe cutoff via `sixMonthCutoffISO` (`storage-utils.js`), queries the
  collection for `date < cutoff`, and skips the just-uploaded `excludeDate`.
- **Deletes only what it read.** The query is a snapshot, and a re-upload for one of those dates
  between the query and the delete would otherwise destroy the FRESH metadata while cleaning up the
  stale object — document gone, new file orphaned. Each delete re-reads inside a `runTransaction` and
  stands down if the `storagePath` has moved (logged as "changed since the query — left alone").
- Only after that transaction commits is the Storage object removed. A Storage delete failure is
  logged via `console.warn` and never thrown; a Firestore delete failure is caught per-doc and logged
  via `console.error` so one bad delete can't abort the rest.
- Called fire-and-forget from the shared upload engine's `postCommit` for both `uploadCircular` and
  `uploadNewsletter` — a failed prune never blocks the upload.
- Covered by `doc-retention.test.mjs`, whose Firestore fake has an `onBeforeDelete` seam that slips a
  competing writer between the query and the transaction — the interleaving no ordering of real calls
  can force.

### Staff access flow

1. Staff taps ☰ → **Weekly Retail Circular** or **Marylebone Newsletter** in the nav-panel drawer.
2. `nav-panel.js` click handler fires. A `_docFetching` boolean guard at module scope returns early if a fetch is already in-flight (tap-guard against rapid repeated taps). On the Calendar, a visitor without access (`!canReadDocuments()`) is refused first — the lightbox names the PIN or sign-in — and no tab is opened.
3. `window.open('', '_blank')` is called **synchronously** in the same event tick as the click — this is required for Safari/iOS to allow the new tab. The blank tab is opened before any async work begins.
4. `getLatestCircular()` / `getLatestNewsletter()` is awaited, raced against an 8 s budget (`DOC_FETCH_BUDGET_MS`), with a short-lived URL requested from `getDocumentUrl` in parallel against the same budget. A read that runs past it is handled as a Firestore error (below); a short-lived URL that runs past it gives way to the stored `storageUrl`:
   - On success with a `storageUrl`: `newTab.location.href = url` opens the file — the short-lived URL, or the stored `storageUrl` when none was minted or when the server signed a different file than the one read (its returned `storagePath` does not match — `resolveDocumentOpenUrl`). A PDF previews in the tab by its own URL; a Word `.docx` is routed through Microsoft's Office Online viewer via `officeViewerUrl` so it renders with images instead of downloading (no Mammoth-style inline HTML conversion, unlike the Huddle). `closePanel()` closes the drawer, popping its history entry.
   - On success with no document (null): `newTab.close()` cancels the blank tab; the coming-soon lightbox is shown.
   - On Firestore error: same as null — cancels the blank tab, shows a retry message in the coming-soon lightbox.
5. `_docFetching` is reset to `false` in `.finally()`.

### Security

| Operation | Requirement |
|-----------|-------------|
| Reads | Require access, as the Huddle does: a bound member identity, the admin claim, or the staff-PIN viewer capability. The client refuses at source behind the PIN (`calendar-doc-access.js`). Files open via a short-lived `getDocumentUrl` URL — used only when the path it signed matches the document on screen — falling back to the stored `storageUrl`, a tokenised bearer URL (ARCHITECTURE.md EXC-007). |
| Writes | `request.auth.token.admin == true` (admin claim only) |
| Storage create/update | Rules enforce PDF or Word (.docx) MIME type + ≤20 MB per file |
| Storage delete | Admin-only; MIME/size checks omitted (no `request.resource` on delete) |

### Firestore / Storage paths

| Resource | Path |
|----------|------|
| Circular Firestore doc | `circulars/{YYYY-MM-DD}` |
| Circular Storage file | `circulars/{YYYY-MM-DD}-{uploadId}.{ext}` (`ext` = pdf or docx; versioned suffix) |
| Newsletter Firestore doc | `newsletters/{YYYY-MM-DD}` |
| Newsletter Storage file | `newsletters/{YYYY-MM-DD}-{uploadId}.{ext}` (`ext` = pdf or docx; versioned suffix) |

## Document links — replacing every old copy

Every Huddle, Circular and Newsletter file has a permanent download link — the record's `storageUrl`.
It carries a key, and whoever holds a copy opens the file with no sign-in: from a browser's history, a
forwarded message, or Microsoft's Word viewer (ARCHITECTURE.md EXC-007). **Operations → Document
links** gives every file a new key, and every old copy stops working at once. Staff notice nothing:
the app opens documents with a 15-minute link signed from the file's PATH, never its key, and each
record's stored link is moved onto the new key before the old one is taken away. The owner asked
for one run when it was built (12 Nov 2026, DECISIONS.md); ARCHITECTURE.md EXC-007 records whether it
has been made.

**When:** a document link has been shared somewhere it should not be — or on a schedule, if one is
ever wanted (AUTH_PLAN.md §5).

**How:**
1. Operations → **Document links** → **Check the links**. This only counts, and says what a run would
   touch: files in use; documents whose stored link no longer opens their file (a run gives each a
   working one); older files no record uses (their link is switched off, the file is never
   deleted); documents whose file is gone; and stored links this cannot read. An unused file from the
   last day keeps its link: an upload saves its file before the document that names it, so a file
   that new may be one still being saved. A check the next day offers it.
2. **Replace the links**, then confirm.

| The card says | It means | Do |
|---|---|---|
| Done. N files have new links | every old copy of those links is dead | nothing |
| N files couldn't be changed, and their old links still work | a write failed; each such file stopped at the step it reached, its stored link still working | press Replace again — safe |
| N files changed while this ran | an upload, or a run in another tab, landed mid-run; those files were left alone | Check again, and Replace if it is offered |
| N documents' links no longer open their files | each stored link names a key its file no longer carries — a document saved after a run had taken its file's key away, or a browser's upload write re-sent after its answer was lost. Staff still open the document through the app's 15-minute link; only the fallback is broken | press Replace — a run gives each one a working link |
| N files from the last day aren't used by the app, so their links were left working | an upload may still be saving the document that names them; a run takes the key only from an unused file at least a day old | Check again tomorrow, and Replace if it is offered |
| N files are left as they are, old links and all | a stored link this cannot read may open them, and touching them could break it | the unreadable links need looking at in a session; the card cannot fix them |
| N files couldn't be checked, so it isn't known yet whether there is anything to replace | the check could not read those files' keys; nothing changes on a check | Check again in a minute |
| It isn't known whether it finished | the answer was lost — a timeout, or the platform's own error | press Replace again — safe |
| Couldn't read the documents, so nothing was changed | the records or the file listing could not be read | try again in a minute |
| Couldn't replace the links: the request was never sent | the page could not get the admin's sign-in token, so nothing left it | check the connection, then press Replace again |
| Couldn't check the links: the server answered 404 | `rotateDocumentLinks` is not deployed | check the latest "Deploy Firebase Functions" run, then Check again |

**Why pressing it twice is safe:** a run only ever issues fresh keys and moves each record onto its
file's newest one. Every key write is a compare-and-set against the file as it was read, and a record
moves only while its link is exactly the one read, so a run cannot overwrite an upload or another run.
A refused write is read back before it is called a change, so a write that landed but whose answer
was lost — the storage library retries it, and the retry is refused — is counted as done.
The rules: `functions/doc-link-rotation.js`. **Logs:** one line per run in the `rotateDocumentLinks`
function log — counts only.

---

## Firebase Auth — full detail

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

`nameToEmail(name)` / `normaliseSurname()` in `auth-identity.js` (the pure browser module — re-exported by `firebase-client.js`, so importers may pull it from either) must stay in sync with the copy in `functions/roster-parse-helpers.js`. The derivation is duplicated in `functions/roster-parse-helpers.js` — intentional: Cloud Functions are CommonJS and cannot import browser ES modules. If the rule ever changes, update ALL THREE copies — `auth-identity.js`, `functions/roster-parse-helpers.js`, and `memberEmailFor` in `firestore.rules` (a mismatch with the rules copy locks that member out). `surname-parity.test.mjs` pins the first two together; the rules suite's whole-roster test in `firestore.rules.test.mjs` pins the third. The rules engine's `lower()` lowers A–Z only, so `memberEmailFor` maps İ (U+0130) and the Kelvin sign (U+212A) by hand to match JavaScript's `toLowerCase()`; the rules suite pins six such names.

**Password derivation rule:** surname, lowercase, alphabetic characters only, **padded to a minimum of 6 characters by repeating the surname** (Firebase Auth's minimum password length). Surnames already ≥6 chars are used as-is; shorter ones are padded by repeating the surname cyclically (e.g. `"tuck"` → `"tucktu"`). The same derivation is used both on initial account setup and by `ensureFirebaseSession()` when it re-establishes an un-migrated member's session on page load with nothing typed. The client never CREATES a missing account: one that does not exist is provisioned only by Operations → Set up accounts. The single source for this padded default is `surnamePassword(fullName)` in `auth-identity.js`.

**Chosen passwords (PASSWORD_DESIGN.md — Track C).** The surname value above is now only the **default** password. A member can set their own in Settings → Password, after which that secret is their real password and the surname no longer works for them. Sign-in tries the typed value first and only falls back to the surname default while the account is still on it (`credentialCandidatesFor` → `ensureFirebaseSession`). **Admin break-glass:** the `resetMemberPassword` Cloud Function (Operations → Account status → Reset) sets a member's Firebase Auth password back to the surname default (`nameToPassword(member)` — the CommonJS functions-side twin of the browser's `surnamePassword`, kept equal by `surname-parity.test.mjs`) and revokes their refresh tokens, so a member who forgets a self-set password is recovered by the admin — there is no email-based self-service reset yet. **A DISABLED account is refused** (v25.77): a reset would leave it unable to sign in, so Reset says so and changes nothing, and the reset-request card marks it "Account disabled — run Set up accounts", which re-enables it on the surname default. **The member is told:** a reset sends `🔑 Password reset — set a new one` to that member's own devices, and nobody else's — unless you tick *Their phone is lost or stolen*, which sends nothing (below, step 5). It never names the new password (a push renders on a lock screen). If they have no notifications on this app the reset still stands and Operations says so, which is your cue to tell them directly — they have been signed out of their devices and would otherwise have no idea why. **Signed out means signed out:** a silent sign-in on a session older than the reset is refused and the session ended (`sessionPredatesReset`, auth-identity.js), so every device the member was signed in on must type a password — otherwise a device still holding the 60-day session would sign itself straight back in with the surname the reset had just restored (AUTH_AND_SESSIONS.md 23). Migration state (`passwordSetAt` vs `resetAt`) lives in the `passwordStatus` Firestore collection.

### Locked-out member → reset request queue

The one flow that starts with **no identity at all**: a member who has forgotten a self-set password
has no Firebase session, so they cannot write anything — which is why this runs through a public
unauthenticated endpoint (one of two, with `unlockCalendarViewer`) rather than a client write. The
design and its accepted risks are `PASSWORD_DESIGN.md` §12–§14.

1. **Member** taps "Can't get in?" on the login overlay — **always available there**, under the Sign
   in button → `requestPasswordReset` in `firebase-client.js` (the one caller there that sends **no**
   auth token) → the `requestPasswordReset` Cloud Function.
2. **Function** (Admin SDK) upserts `resetRequests/{memberName}` — `requestedAt`, `count`, and
   `provisioned` (false ⇒ the remedy is **Set up accounts**, not Reset). The doc ID is the member name
   *deliberately*, so the collection can never exceed the roster; the name comes from the server-owned
   `activeMembers` list, never the request body, and **no free text is ever stored**.
3. **Admin push** — a genuinely-recorded request (never a throttled repeat) sends
   `🙋 Reset requests — N waiting` to the **admin's devices only** (`sendTargetedPush`, never
   `fanOutPush` — `.claude/rules/notifications.md`), deep-linking to `operations.html#reset-requests`,
   which opens and scrolls to that card. The push is a courtesy — the Firestore row is the doorbell.
4. **Admin** actions it in Operations → Password Reset Requests (Reset, or Set up accounts if
   `provisioned` is false), then clears the row (`clearResetRequest`). **A request proves nothing about
   who sent it** — confirm with the member before resetting (PASSWORD_DESIGN.md §13). Create/update is
   denied to every client **including the admin**; only the function writes.
5. **The member is told, on their own devices.** `resetMemberPassword` sends
   `🔑 Password reset — set a new one` via `sendTargetedPush` to the uid it has just written,
   deep-linking to `settings.html`, where the Password card opens itself. **The new password is never
   in the payload** — a push renders on a lock screen.

   Operationally the figure to read is **`notified`**, reported beside `revoked` and `stamped`: the
   credential has already changed by that line, so a push failure never means the reset failed. A
   member with no subscription is a legitimate `false`, and any reset nobody was told about — whether
   or not the sign-out worked — is the admin's cue to reach them another way.

   **A lost or stolen phone: tick the box.** The Reset dialog asks "Their phone is lost or stolen",
   unticked. Ticked, the server sends no notice (it would land on that phone's lock screen) and deletes
   every push record the account owns, so the phone receives nothing more; the result says so, or that
   the records could not be removed, and to reset again with the box ticked. Either way **you tell the
   member yourself**. The password is the surname default afterwards, and the sign-in card names it, so
   ask them to sign in on another device and choose a new one promptly — until they do, whoever holds
   the phone could type it too.

**A device that subscribed before v17.76** (when `owner` was first stamped on subscriptions) needs
nothing doing: `notif.js` re-saves the record with its owner at the next load, outside its 24-hour
throttle.

### Sign-in statistics

The Operations → Usage card shows an **exact** unique-account count beside the anonymous trend. It
comes from `getSignInStats` (admin-only), which reads Firebase Auth's own `lastSignInTime` — so
uniqueness is a property of the data rather than something the app has to enforce, and nothing new is
stored. Filtered to an allowlist of the current server-owned roster so an un-swept leaver cannot
inflate it; returns four integers, no identity. It measures **sign-ins, not activity** (sessions last
60 days, so most page opens are session *restores*, and the 30-day window is shorter than a
session), and there is no history — only
the last sign-in is stored. `neverSignedIn` is the actionable figure.

### Which address staff are on

While the app is served from BOTH `myb-roster.web.app` and the GitHub Pages mirror, the Usage card's
**Which address staff are on** section is the only record of how far the move has got: member-devices
per address over the last 30 days, each counted on its latest active day, with the share that opened
the **installed app** rather than a browser tab nested inside each bar and stated as a number beneath
it — "9 of 24 on GitHub Pages" is the figure a retirement decision needs. Each row names its full
address underneath.

**Read it knowing what it cannot see.** It counts OPENS, so an install nobody has opened in 30 days is
invisible — and those are exactly the people a migration strands. Someone using both addresses counts
on each, which is what half-migrated looks like. A signed-in admin's loads are excluded, like every
other figure on the card; the station PC's are counted (KNOWN_LIMITATIONS.md → "The Usage counts are a
trend" says why the figures stepped up when that changed).

**Why it matters operationally:** an installed PWA keeps launching from its own service-worker cache,
so it will not drift onto the new address by itself. Anyone who does move loses their pay calculator
data unless they carry it across first (paycalc → Move Your Pay Data), because localStorage is
per-origin. The counters are how you tell whether that has happened yet.

The `@myb-roster.local` domain is synthetic — not real email addresses. Firebase Auth accepts them as valid email format.

Migration history (v7.61 → v7.94) is in `ROADMAP_HISTORY.md` → Completed phases.

---

## When "Deploy Firebase Functions" fails at "Audit production dependencies"

The Functions deploy refuses to ship while `npm audit --omit=dev` in `functions/` reports a high or
critical advisory (`scripts/audit-functions-deps.sh`). It can fail on a day nothing in the app changed,
because advisories are PUBLISHED against packages already installed — typically transitive under the
Firebase SDKs. Nothing is deployed, so the live functions stay on the previous release; hosting deploys
separately and is unaffected.

The fix: in `functions/`, `npm audit fix --omit=dev` (never `--force`, which can downgrade a major),
check the lockfile diff is patch/minor releases only, run `npm run test:functions`, bump the version
(CI counts `functions/package-lock.json` as served) and merge. The deploy re-runs on the merge.

## The Pages mirror — behind the Hosting gate

**Why.** Most staff open the app on the GitHub Pages mirror. Until 10 November 2026 GitHub built it
straight from `main` with no test of any kind: on 24 Oct 2026 v24.94 failed the Firebase Hosting gate
while the mirror shipped it, so for about three hours most staff ran a release the gate had refused.
Since 10 November 2026 the mirror is published by `deploy-mirror.yml`, and only after a passing Hosting
run; the first release it published was v25.65. What is still open is that `main` requires no checks
before a merge — `ARCHITECTURE.md` → EXC-008, and step 1 below.

**How it works.** `deploy-mirror.yml` publishes the
mirror from the commit a SUCCESSFUL "Deploy Firebase Hosting" run released, and from nothing else:
it checks that the run was a push to this repository's `main` or a run started here by hand (a fork's
pull request with a workflow named like the deploy is refused) and that `main` contains the commit,
checks every precached file is in the site, deploys, then proves the live mirror serves that
version, and a failure lands on the same `deploy-failure` issue as the other deploys. It reads the
Pages setting first, and stands down if Pages is ever set back to build from the branch (Undoing it,
below). The hourly currency check knows the difference too: the gated mirror trails Hosting rather
than leading it, so "both origins behind" during a release is not reported.

**The owner's settings — none of them can be made from the repository.** Steps 2 and 3 were made on
10 November 2026; step 1 is still open.

1. **Require the checks on `main` — still open.** GitHub → the repo → Settings → Rules → Rulesets → New branch
   ruleset. Target the default branch. Turn on **Require status checks to pass** and **Require
   branches to be up to date before merging**, and add the checks from a recent pull request run:
   `version`, `unit`, `nodeps`, `functions`, `rules`, `csp`, `signed-in` and every `smoke` entry (three
   per screen size since 12 Nov 2026: `smoke (chromium, 1/3)` to `3/3`, and the same for
   `mobile-chrome`). `signed-in` is one check for both phone engines; its Android Chrome half has gated
   the Hosting deploy since 12 Nov 2026. Leave out `guard` (it decides whether the others run), and
   `visual` / `visual-webkit`, which are report-only by design. Whether the `webkit` entries gate
   merging is your call: the deploy gate deliberately runs Chromium only (DECISIONS.md, 8 Sep 2026).
2. **Require approval for outside contributors — made 10 Nov 2026.** Settings → Actions → General →
   "Approval for running fork pull request workflows from contributors" → **Require approval for all
   external contributors**. The mirror does not trust such runs anyway; this stops them running at all.
3. **Switch the Pages source — made 10 Nov 2026.** Settings → Pages → Build and deployment → Source:
   **GitHub Actions**.

**Publishing by hand.** Actions → "Deploy GitHub Pages mirror" → Run workflow, from `main`. A manual
run, or a re-run, publishes the newest commit Hosting released from `main` — never main's tip.
**After any change here, check it**: open `https://garethdavidmiller.github.io/roster-app/` in a
private window — past the splash, no red errors in the console (the deployment health check at the top
of CLAUDE.md).

**What it means for a release.** The mirror updates after a Hosting deploy finishes, not a minute
after the push. A deploy lasts as long as its slowest gate job plus about a minute. The gate jobs are
`check`, the six `smoke` shards, `csp` and `signed-in` (Android Chrome only), and the slowest is a
`smoke` shard: 5 to 8 minutes since each screen size was cut into three on 12 November 2026. The
mirror's own publish then takes under a minute (40 and 55 seconds on 10 November 2026; the first,
v25.65, took about nine). A push that changes only docs or tests republishes neither
origin, exactly as Hosting already behaves. A failed gate leaves BOTH origins on the previous release,
and the issue says so.

**Undoing it.** Set the Pages source back to "Deploy from a branch" (`main`, `/ (root)`). The
workflow notices and stands down; nothing else needs touching. The `.nojekyll` file is what the
branch build needs, so it stays either way.

## Removing a staff member

Five steps, and **the order matters** — step 2 changes what the roster parser can read. Referred to
from CLAUDE.md, the `/leaver` and `/new-starter` skills and the Overtime section below, all of which
carry the tick-list; **this is the long form and the only home of the reasoning** — `/leaver` is the
executable checklist and routes here rather than restating any of it.

**1. Upload the final roster PDF that still contains them.**

`hidden: true` does not only hide somebody from the member dropdown. `generate-roster-members.mjs`
builds each AI-parsing name list as `role === <grade> && !m.hidden && !m.managerOnly`, so hiding them
**removes them from the `cea`/`ces`/`dispatcher` list the parser matches rows against**. A roster PDF
covering their last days, uploaded after that, has a row for somebody the parser no longer knows.

It does not fail loudly: the run reports them under `missingMembers` — "the AI returned NO row for
this member" — which is the same advisory a genuine absence produces. So the week imports, looks
complete, and quietly has nobody rostered on their line.

**2. Set `hidden: true`, regenerate, ship.**

Edit the `teamMembers` entry in `roster-member-data.js`, then `npm run generate:roster-members` **in the same
commit** — `sw-asset-check.test.mjs` fails if the two drift. Bump and deploy as usual.

There is no end-date field — `startDate` has no counterpart — so until this lands their base roster keeps producing
shifts: they appear in the calendar and in Team Week View as though still working. Nothing breaks,
but a manager planning a week is reading a line nobody is on. Do it promptly once step 1 is done.

**2b. If they held a role, take them out of it as well.**

`CONFIG.ADMIN_NAMES`, `CONFIG.MANAGER_NAMES` and `CONFIG.LINKS_DESIGNERS` are plain name lists and
are **not filtered by `hidden`**. `resolveRosterAuthConfig` unions every role-holder into
`processMembers` — deliberately, so a leaver sweep can never disable the admin — with the
consequence that **a manager or designer left in one of those lists is immune to step 3**. They stay
in the server's active set, the orphan filter never sees them, and their login goes on working.

It is also the one failure in this sequence that **step 4 cannot catch**: the audit compares Firebase
Auth against the server's active set, and as far as the server is concerned they are still active. So
it reads as a clean bill. Check the three lists by hand when the leaver held a role.

**3. Operations → Staff Login Accounts: tick "Disable accounts for anyone no longer on the roster
(leavers)", press Set up accounts, read the dry-run preview, then press Confirm.** Nothing is disabled
until Confirm.

**A manager or clerk (`managerOnly`) is the exception to step 2: remove their ROW from `teamMembers`.**
Every active Management row already carries `hidden: true` (it keeps them off the Calendar's member
selector), so `getMembersForGrade('Management')` does not filter on it — hiding one changes nothing,
they stay in `activeMembers`, this step never disables them and step 4 reads clean. Their rows hold no
roster to resolve. Take them out of `CONFIG.MANAGER_NAMES` in the same commit (step 2b).

Hiding them removes them from `activeMembers`, which is the server-owned list `setupRosterAuth`
trusts — but that governs PROVISIONING, not revocation. The Firebase Auth account keeps working until
this is run, and the surname default is still a valid password for it (`ARCHITECTURE.md` → EXC-005).

**It also stops their notifications.** A leaver who never pressed Sign
out — the normal case: they simply stop opening the app — keeps a push record stamped with their
account, and the staff broadcasts (the Huddle, the Circular, the Newsletter and the one-off timetable
reminder) go to every record, so their phone went on receiving them indefinitely. The pay reminder is
not one of them: it is targeted from the current roster, so it never reaches a leaver. The confirmed sweep now deletes the records the
disabled account owns (`releasePushForOwner`, `functions/push.js`). A record older than v17.76 has no
owner and cannot be attributed; it goes when the push service retires it.

**4. Check it actually took.**

The Staff Login Accounts card states its own condition, above the button: a read-only audit
(`getAccountSetupGaps`) comparing the server-owned roster against Firebase Auth. Done properly it
reads *"Everyone on the roster has a login, and no leaver still has one."* A leaver who is still
enabled is named there ("1 leaver can still sign in"), and the **Needs attention** strip at the top of
the page carries a *Leavers still active* item until it is fixed.

This step exists because **every failure in steps 1–3 is silent**. A skipped step 3 leaves a working
login, and the dry-run preview inside Set up accounts is otherwise the only place it shows — a check
you have to already suspect you need.

If the block says it **couldn't check** — the connection, an account list the server could not see
(it declines to name the whole roster as missing rather than guess), or an answer it could not read —
that is a third answer and not a pass. Retry it.

**"Reset to the default password and signed out"** (v24.24; worded "Taken back and reset to the default
password" until 10 Nov 2026) is a line Set up accounts prints when it finds an account at a roster
email carrying no custom claim at all — somebody registered that email from outside before the server
provisioned it — and also for a DISABLED account at a roster email that it re-enables, such as a
returning leaver's, from whom nothing was taken back. It stamps `resetAt` FIRST (so Settings asks them
to choose a new one, and a stamp that cannot be written changes nothing), then resets the password to
the member's surname default and signs out every session on it. A disabled account also has the push
records it owns removed, and is enabled only after all of that. The claims are stamped last. The
member named there should be told their password is their surname.
The take-back never fires for an account provisioned before v24.24: those already carry claims. A
**`reclaim-failed`** (the take-back) or **`re-enable-failed`** (a disabled account) entry under
failures means it did not complete and NO claims were stamped on that account (after
`re-enable-failed` it also stays disabled) — run Set up accounts again.

**The card names who a run will reset before you press it** (sign-in audit, Nov 2026). The audit's
reasons are *no account*, *wrong permissions*, *no permissions* (an account registered from outside —
`unstamped`; an older server called it `claims`) and *account disabled*. The last two are reset to the
surname default and signed out by Set up accounts, so the card says so by name, and you can tell them.

**"Access reduced and signed out of every device"** names anyone a run took admin, manager or Links
designer from (`demoted`): the account's sessions are revoked, so the old access stops at once rather
than when the sign-in renews. Their password is untouched. A **`lookup-failed`** or **`stamp-failed`**
entry under failures means a new account was NOT created for that name (its `resetAt` must land first)
— run Set up accounts again. A confirmed leaver run also switches off the notifications of leavers
disabled on an earlier run whose phones had saved them again, and counts them when there were any.

### What this does NOT do, and has to be done per week

**Overtime.** A week's participant population is frozen when the week opens, so hiding somebody only
affects weeks created afterwards. They stay outstanding in every already-open week until the horizon
rolls past. Use **Stop asking** on their row in *Who is being asked*, once per open week — see
"Somebody who has left, and is being chased every week" below. A closed week refuses it by design.
Nothing to do here while Overtime is paused (`OVERTIME_AVAILABILITY.md` → Paused): no week asks anyone.

**Their data stays, and that is deliberate.** Overrides are keyed by name, so their past shifts, AL
and absences remain an accurate record of what happened. Their `staffContact` work email also
survives; removing it is a separate decision nobody is forced into by this procedure.

## Changing a member's roster name

There is no rename procedure today, and one consequence is easy to miss. A member's Pay Calculator
figures on each device are stored under their name, so after the change they stay under the old one.
A backup they saved under the old name is refused, and the app tells them to contact the admin.
Ask them to note their figures before the change. Carrying the figures across would need a
former-name record on the member, which does not exist yet.

---

## Which year's allowance a January leave day comes out of

Some staff are allowed to take a few of one year's days in early January of the next (owner, 3 Nov
2026). By default a January leave day counts against its own year; the **"Which year's allowance"**
panel on Admin's Annual Leave card lets it count against the year before instead. A member moves
their own days, a manager or the admin anyone's, and a day can never move to a year with no days
left. The design and the owner's decisions are in `leave-year.js`; the field is `leaveYear` in
docs/DATA_MODEL.md.

**It is ON.** The switch is `LEAVE_YEAR_CHOICE` in `leave-year.js`, and the assertion in
`leave-year.test.mjs` changes with it, deliberately. It shipped switched off first and was turned on
only once **Deploy Firestore and Storage Rules** had finished green, because the rules that accept
`leaveYear` and the app that writes it deploy in parallel from one push (the backend-first rule, CLAUDE.md → Workflows).

Check it: Admin → Record Annual Leave, for somebody with leave booked in January — the panel appears
beneath the Record button, listing those days with the two years to choose between.

**Switching it off again** hides the panel. Days already moved keep counting against the year they
were moved to — counting reads the stored year whatever the switch says, so no figure changes.

**What the app cannot enforce.** "No more than the previous year has left" is a count across
records, which database rules cannot take. The panel refuses it; a request sent around the app is
not checked. That is the same footing as the leave booking's own over-allowance warning.

**Against the depot workbook,** from January on: the app counts moved days in the earlier year, the
workbook carries them forward as c/f into the later one. Next year's remaining agrees; last year's
differs by exactly the moved days (AL_WORKBOOK.md §9).

## Staff PIN access for the Calendar

The Calendar opens for **either** a signed-in member **or** the shared staff PIN. Every other
protected page but Trains — Admin, Settings, Operations, Links, the Pay Calculator and the rest — still
needs a real member sign-in; the PIN grants reads, not identity: *the Calendar's override data* and the three documents (the Huddle,
Circular and Newsletter); its only writes are the error log and the usage counters
(`isKnownIdentity`). The one other page it opens is **Trains** (owner, 22 Oct 2026), which reads
nothing at all — the timetable is public — and was admitted because the staff customers ask are the
station's (AUTH_AND_SESSIONS.md invariant 24). **The PIN is a barrier, not authentication** — no
surface may describe it as signing somebody in (AUTH_AND_SESSIONS.md invariant 18).

### Why it exists

Staff open the roster on shared office PCs for a quick look. Signing into a corporate Windows
account gives them a fresh browser every time, so a full member sign-in for a thirty-second glance
is friction nobody would accept. Without the PIN, override data — annual leave, absence and shift
changes for every member — would be readable by anyone with the URL, which is how it was before. The
PIN is what lets both be fixed at once.

### What a member experiences

| Situation | What happens |
|---|---|
| Signed-in member, live session | Nothing changes. No PIN, no interruption; the session rule (60 days) is untouched. |
| Any browser holding nothing — a new phone, a shared PC's fresh browser | The Calendar area shows the **member sign-in card** first (grade · name · password — the same card as the other pages), with **"Use the staff PIN instead"** beneath it and a line saying who the PIN is for: visiting or agency staff, or anyone without a password yet. One tap → the "Enter the staff PIN" card. Four digits → the roster, including whichever member was last selected on that machine. A station PC can bookmark `./#staff-pin` to land on the PIN card directly. |
| Same browser, reload or navigation | Stays unlocked. The viewer session lives as long as the browser session. |
| Browser closed and reopened | The PIN is asked for again. That is the point — a PC left on a Windows account does not carry the roster into the next person's day. |
| Guides | Reachable **without** the PIN. The nav drawer is never locked. |
| Huddle, Circular, Newsletter | Need the PIN or a sign-in. A locked tap says what to do rather than opening; a notification tap is held on the PIN card and finishes once access is given. |
| Trains page | Opens with the PIN, from the drawer's 🚆 Trains pill, and the PIN is still held on the way back. Its drawer shows **Staff PIN access** and **Lock Calendar**, which locks the station and lands on the PIN card. Admin, Pay and Settings still ask for a member sign-in, and signing in there ends the PIN. A fresh browser that opens Trains directly is asked to sign in — the PIN is entered on the Calendar. |
| A member whose sign-in has been lost from the device | They get **their own sign-in card**, never the PIN — see below. |
| A slow start on a poor connection | A greyed-out calendar shape while the app works out what to show, rather than a blank screen. |

The PIN card's **"Sign in instead"** goes back to the sign-in card, and a viewer can press **Lock
Calendar** in the nav drawer before walking away — that lands on the PIN card, because whoever
pressed it got in with the PIN. **The sign-in card comes first** (owner decision, 7 Sep 2026) because
most people opening the app are staff with a password of their own, and signing in is what ends the
code for them for 60 days.

### "It asked me for a PIN and I'm signed in"

A support question worth recognising, because it can have two quite different causes:

- **The device lost the member's Firebase sign-in while keeping the app's own 60-day session.** Seen
  mostly on iPhones; the likeliest route is a storage read that failed, not Safari's seven-day rule,
  which clears both together and leaves a member simply signed out (KNOWN_LIMITATIONS.md → "A
  signed-in session lasts 60 days", "One interaction to expect on iOS"). The member is, as far as
  they and the app know, signed in — with nothing behind it.
- **The sign-in was simply slow to come back.**

Neither lands on the staff PIN: a signed-in member is never sent to the shared code (CALENDAR_DATA.md
invariant 11). That member gets a card addressed to them whose button is the normal sign-in — and for
anyone still on their surname default the app quietly signs them back in with nothing typed, so they
see nothing at all. A late sign-in is honoured whenever it turns up.

**If a member still reports it:** ask whether the card said "Calendar · <their name>". If it did,
that is the sign-in card working as intended and the remedy is their password. If they genuinely saw
the four-digit PIN card, they have no session on that device — which is expected on a shared PC and
on any browser they have not signed into.

### There is no on/off switch

Rollback is reverting the release (and, for the read rule, RECOVERY_RUNBOOK.md → "The Calendar PIN").
The client switch the PIN shipped behind, `CONFIG.CALENDAR_PIN_ACCESS`, was retired because the rules
no longer allow the anonymous session its `false` mode restored — flipping it would have shown every
visitor a base roster under a "couldn't update" chip, a roster that is WRONG rather than obviously
broken.

`overrides` reads require a bound member identity (`isMember()` — AUTH_AND_SESSIONS.md invariant 19),
`admin`, or the `calendarViewer` capability, and the server refuses anything else. The rollout's
lesson, for any comparable change: **client first, rules second, as separate pushes** — the deploy
workflows run in parallel, so which lands first is a coin toss, and rules-before-client is the state
that shows every staff phone a roster that is wrong rather than obviously broken (RECOVERY_RUNBOOK.md →
"The Calendar PIN" has the steps).

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
const { getAuth } = require('firebase-admin/auth');
await getAuth().revokeRefreshTokens('calendar-viewer')
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
4. `firestore.rules` allows `overrides` reads for a bound member identity (`isMember()`: a password
   sign-in on the name's derived email, carrying the server-set `member` claim) or `calendarViewer`
   on a custom-token sign-in.
   The viewer writes nothing a member owns: its only writes are the error log and the usage counters.

### Abuse protection

A four-digit PIN is 10,000 combinations, so the endpoint is throttled server-side **two ways**, both
recorded in the server-only `viewerAttempts` collection. Only *failures* stay counted: every attempt is
charged BEFORE its PIN is compared and a correct PIN is refunded afterwards. The reasoning — why the
charge comes first, what the contention costs, and why the per-source key is read from the END of
`x-forwarded-for` (a caller can only prepend to it) — is `functions/calendar-viewer-auth.js`'s header.

1. **Per source — 30 failed attempts per 15 minutes, then a 15-minute block.** Sized for a station
   behind one corporate NAT address: thirty *wrong* entries in fifteen minutes from the whole
   building is not fumbling, and a correct PIN never stays counted.
2. **All sources — 200 failed attempts per 15 minutes**, under a fixed key no header can touch. This
   caps the whole endpoint at 800 guesses an hour, so the full PIN space takes upwards of twelve hours
   of obviously abnormal traffic.

Blocks expire on their own; there is no permanent lock, deliberately, because a shared-source
control that anyone can drive into a permanent state is a denial-of-service handle pointed at staff.
**If the all-sources ceiling ever trips during normal use, the code in circulation is wrong — reissue
it rather than raising the number.**

**If the throttle store itself is unreachable, the endpoint refuses (503) rather than guessing
unthrottled.** The refusal costs nothing real: the overrides live in the same Firestore the throttle
read just failed against, so a token minted during that outage could not have loaded a single shift
anyway. Staff see the card's ordinary "try again shortly" message, and the moment Firestore recovers
both the unlock and the roster come back together.

### Diagnosing a problem

- **"PIN not recognised" for everybody** → the PIN was rotated without redeploying the function,
  which still holds the old value. Check `firebase functions:secrets:access CALENDAR_VIEWER_PIN` and
  redeploy.
- **"Calendar couldn't be unlocked. Try again shortly." for everybody** → the function is failing,
  not refusing. A 503 whose body and log say "Calendar access is not configured" is an unset or
  malformed secret; a 500 on every CORRECT PIN is the missing IAM grant (`roles/iam.serviceAccountTokenCreator`
  on the runtime service account — RECOVERY_RUNBOOK.md project facts), which is what broke the
  first rollout. Neither message names the cause on screen; the Cloud Function log does.
- **Unlock succeeds, Calendar shows no shifts** → the token minted without its claim, or the rules
  and the client disagree about the claim name. `calendar-viewer-parity.test.mjs` is the guard for
  the second; the Cloud Function log line `[unlockCalendarViewer] unlocked <hash>` confirms the first.
- **Nothing in the Operations Error Log** → expected. A locked Calendar has no Firebase identity, so
  it cannot write client errors. Use the Cloud Function logs.

---

## Overtime Availability — PAUSED

**PAUSED (owner, Nov 2026)** — closed to everyone, the admin included, and nothing runs but the
retention purge, so nothing in this section applies until it returns. `CONFIG.OVERTIME_ENABLED` in
`roster-data.js` is the switch; `OVERTIME_AVAILABILITY.md` → Paused has what it does and the way back.
The rest of this section is kept as the operating guide for its return.

Staff declare, per day, when they are available for overtime in a future roster week; a Manager or
Master Admin reads the answers by day and plans cover from them. Full design — the milestone
timetable, the frozen participant snapshot, the audience ladder, retention, concurrency — is in
`OVERTIME_AVAILABILITY.md`. This section is the operating half.

### The weekly rhythm

Windows are named by their **week-ending Saturday**. Counting back from it (`MILESTONE_OFFSETS` in
`functions/overtime-core.js` is the authority):

| When | What happens |
|---|---|
| Sat −18d, 12:00 | **Initial deadline.** Everyone should have answered. |
| Sat −16d | Draft roster published. |
| Sat −11d, 12:00 | **Final deadline.** Forms close; answers are final. |
| Sat −9d | Final roster published. |
| Sat +91d | The window expires and stops appearing anywhere. |

### Weeks open by themselves — there is nothing to remember

**A scheduled job creates every missing horizon week at 05:00 London, daily.** Overtime
is needed every week, so a window is needed every week, and pressing a button fifty-two times a year
to approve a computation you cannot influence is not a control — it is a way to forget. Daily rather
than weekly, so a missed run self-heals within a day instead of losing a whole week.

*Upcoming weeks* is therefore not a safety net under a person but the **monitor over that job**. It still shows every horizon week whether or not any exist — because it is
computed from the calendar, not from Firestore — so a week the scheduler failed to create still
appears, still says it has no form, and still offers the button. Its collapsed chip counts the weeks
**without** a form; that chip is the thing to glance at.

Row states, and what each means:

| Row says | Meaning |
|---|---|
| **Form open** | Staff can answer. The page opens on the earliest of these — the week being planned. |
| **Form closed** | Created, and past its final deadline. Still readable; that is the record the roster was planned from. |
| **Opens automatically overnight** | No form yet, and none needed by hand — tonight's run will make it. |
| **Did not open overnight · create it here** | The last nightly run was due to open this week and did not. Press **Open now** on the row; that fixes the week whether or not the run itself is ever diagnosed. Investigate only if it repeats — the Functions log for `autoCreateOvertimeWindows` says what happened. |
| **No form yet · first deadline has passed** | Still opens automatically, but late enough to be worth a look: anyone answering now misses the draft roster. |
| **Missed · no form was opened, so nobody was asked** | The final deadline went by with no window. It cannot be recovered, and the row stays until its Saturday passes. |

### Nobody is asked silently any more

Two push notices go out on their own, both **only to the people they concern** — never a broadcast:

| Notice | Who gets it | When |
|---|---|---|
| ⏱️ *Overtime — availability form open* | each member a window has just started asking | the run that adds them, naming their soonest deadline **still ahead** — a week opened late names the final deadline, never one already passed |
| ⏱️ *Overtime — answers due today* | participants who have submitted **nothing** | the morning of the initial deadline |

A member added to several weeks in one run gets **one** notice, not one per week. Somebody who has
already answered is not reminded, and a withdrawn participant is not asked at all.

What this means operationally: a member with an account and a subscribed device has been told
twice, so a remaining "No response" is much more likely to be a real answer — they cannot do it — and
worth a call rather than a nudge.

**It can fail quietly, by design.** A member with no Firebase account, or who has never turned
notifications on, is skipped rather than guessed at; the send can never fail the window it announces.
So absence of a notice is not evidence of anything — the page is the record, the push is a courtesy.
If you need to know whether one went, the Functions log lines are `[overtimeAsked …]` and
`[overtimeReminder …]`, and each states how many targets it could resolve.

### Opening a week early, by hand

Rarely needed. Overtime → **Upcoming weeks** → **Open now** on the row — a deliberately secondary
button, because making it the loudest control would teach a habit the scheduler exists to remove. A
confirm bar previews the roster week, the initial deadline, the audience and the expected
participant count; press **Open the form** to commit. The preview is produced by the same server
code that commits, so it cannot drift.

A row with no button is one whose final deadline has already passed — that week is missed and cannot
be recovered by creating it late.

### During and after the window

**Who is available** opens on the week being planned — the earliest one still open — and *View* on
any other row switches to it, including the **Previous weeks** list beneath the horizon, which
reaches every week still inside the 13-week retention.

It shows that week by day, in three sections that never merge: Available, Not available, and **No
response**. The third is not a soft "no" — nobody has answered — and it is the list a phone call
works from, alongside *Awaiting a form*. Above the days, a strip of seven chips gives the count who
offered **some** availability on each. Only **zero** is marked, in red: a count above zero is left
plain on purpose, because the app does not know which shift you are short of — four people
free before 07:00 do not fill a late turn, and a "1–2 is low" amber band was the app putting a
verdict on a number it cannot judge. Tap a chip to show only that day, *All week* to bring them back.

**Each person's row states their current roster.** Beside the name and grade sits the same
shift chip the calendar draws — 🏠 Rest, ☀️ Early 07:15–15:45 — for that date. An answer is only
actionable next to the duty it was built from, and the case this exists for is somebody who declared
"rest day, available all day" and has since BEEN given overtime: no use for cover, and nothing said
so before. Where an answer was anchored to a shift that has since moved, the row adds **Roster
changed since this answer** — their declaration stands, the ground under it moved.

Two other markers, and they mean different things. **Submitted after initial deadline** — nothing
was received from that person until planning had started. **Changed after initial deadline · was …**
names what that day previously said, and appears only on the days that actually moved, so wherever
you see it something changed there.

**Viewing by grade.** Above the day chips, one chip per grade in the week — *All grades · CEA · CES ·
Dispatcher*, whichever are actually in it. Picking one narrows **everything**: the day counts, the
forms-received line and the name rows all recompute for that grade alone. That is the point rather
than a nicety — a CEA gap is not filled by an available CES, so "Tuesday has four" is only an answer
once you know what those four are. A week with only one grade in it shows no chips; they appear by
themselves once a second grade is in the week.

Your grade choice **follows you between weeks**. The day filter does not, because its dates belong to
the week you were looking at.

### "Asked to come off this Sunday"

A member ROSTERED to work a Sunday can tick **Ask to be taken off this Sunday** on that week's form,
and their row on your list carries the request. It is the operating half of a gap the app could not
state before: Sundays are uncontracted for every grade, so annual leave and absence cannot be
recorded on one — which is right, and which left "I am away for my Sunday duty" with nowhere to go
except a free-text tag in the depot's workbook.

Three things to know before you act on one:

- **It is a REQUEST and the app grants nothing.** No override is written, no roster changes, no leave
  is consumed. You decide, outside the app, exactly as you did before — and the app records nothing
  about your decision, so the calendar keeps showing that Sunday duty until the week's roster PDF is
  imported or the shift is changed in Admin.
- **It is NOT an answer about overtime**, and the two are deliberately separate questions. A
  member can be unavailable for overtime all week and still need taking off their Sunday; a member
  can ask to come off it and still not have answered the availability question at all, in which case
  that day stays in **No response** and their form still says a day is outstanding. Do not read a
  request as either answer.
- **It only ever appears on a Sunday.** The form offers it on a Sunday the member is rostered to work
  and the server refuses the field on any other day, so a request under a Monday is not something to
  interpret — it is a client that should not exist.

### Somebody who has left, and is being chased every week

The population of a week is frozen when it opens — that is what makes "3 of 5 received" mean
anything. It also means a **leaver stays in every open week as somebody outstanding**, week after
week, until the horizon rolls past them.

**Stop asking** on their row in **Who is being asked** ends that for that week. They come out of the
expected count, out of every day panel and out of the chip beside the card title, and a **Not being
asked** footnote appears at the bottom of the week naming them, who stopped asking, and when. Their
form and anything they already said are kept — this changes what the week expects, not what
happened. **Ask again** on that footnote puts them back — until the first deadline for somebody
stopped before it, and while the week is open for somebody stopped after it.

*Who is being asked* lists everybody the week still expects, each marked **Answered** or **No form
yet** — so somebody who submitted one week and left the next can be withdrawn too, which is a common
way to leave. Withdrawing also reaches the **member**: a withdrawn person's own Overtime page stops
showing the week and their form stops accepting answers, so they are not still filing declarations
into a week that has stopped counting them.

Do it per week, on each open week they appear in. A **closed** week refuses it, and that is the
design rather than a limitation: a closed week is the record the roster was planned from, and
somebody who was employed, was asked and did not answer is accurately recorded as exactly that.

Withdrawing is not a substitute for the roster itself — set `hidden: true` on a leaver in the usual
way (see **Removing a staff member**), which is what stops them appearing in weeks created after
that point.

**On the member's side**, the page opens on the soonest form they have **not yet answered** rather
than simply the soonest — a completed form is not an answer to "what do I need to do?".
The form names both deadlines, emphasising whichever is still ahead, and a submitted one carries a
standing "Submitted · updated …" line so a member returning to it can see it landed.

After the final deadline the member's form goes read-only and states the deadline it closed at.
Availability recorded before the cut-off is what the roster is planned from; confirm directly with
the employee before arranging short-notice cover.

### Printing it

**Only *Who is available* prints.** Print from the **Everyone** tab and you get a call sheet: the
week, when the availability was read, how many forms are in, then every day with its three sections
and the *Awaiting a form* list. Anyone the week has stopped asking prints too, in the same footnote —
a sheet whose counts quietly excluded somebody would be the one thing that footnote exists to
prevent. It prints the whole week even if you have a day chip selected, and
the answer chips print outlined rather than filled so they survive a mono printer.

A **grade** filter, unlike the day filter, IS carried onto the paper — printing one grade's
availability is a normal thing to want — so the sheet states its scope under the title
("All grades", or "CEA only"). Check that line before acting on a printout.

The **as at** line is the important one. Availability keeps changing until the final deadline and
paper cannot follow it — that line says how old the sheet is, so treat anything printed before the
deadline as a snapshot and confirm with the person before committing cover.

Printing from **My availability** gives a short notice instead. It is a form, not a document.

### Who can see it

- **Reviewers** (Manager or Master Admin claim) get the nav pill, the planning horizon and the
  by-day workspace. A reviewer who is not also a participant correctly has no form of their own.
- **Participants** get their own form and nothing else. During the restricted beta the audience is
  server-owned and deliberately narrow (`CONFIG.OVERTIME_BETA`, regenerated into the server copy) — a
  Manager can see which audience a window will have and cannot change it. Widening it is a code change
  plus a deploy.
- **When somebody is invited, which weeks do they get?** Every week whose **first deadline is still
  ahead of them** — the nightly run adds them to those, so an invitation takes effect overnight with
  nobody pressing anything. Weeks already past their first deadline are deliberately skipped: they
  could not have answered those on time, and adding them would show them as a non-responder for a
  deadline that pre-dated their invitation. So expect a new tester's first form to be a week or two
  out, not the current one, and do not read that as a fault.
- **Everyone else** sees a short "not open to everyone yet" panel and no nav pill.

### Diagnosing a problem

- **"Couldn't load overtime availability"** → the Overtime Cloud Functions or the Firestore rules
  have not deployed. All three deploy workflows fire in parallel from one push with no ordering
  guarantee; the page is correct to report a failure and recovers on its own once they land.
- **A whole week never opened** → check the `autoCreateOvertimeWindows` logs. It states what it did
  NOT create as well as what it did, and it stands the run down entirely rather than proceeding if
  it cannot list the existing weeks. *Upcoming weeks* shows the gap either way; **Open now** fixes
  it immediately, provided the final deadline has not passed.
- **A member says the form is offering the wrong time** → their shift changed after they answered.
  Their stored answer keeps the time they gave (a roster change must never silently re-point a
  declaration), and the day now carries a note saying the shift has moved. Nothing needs doing
  unless they want to change their answer.
- **`no-participants` (409) on Create** → the audience selected nobody. Realistically a
  misconfiguration; it fails closed on purpose, because a window with nobody in it reads
  "0 of 0 received", which looks like a completed week.
- **A new starter never gets a form** → `functions/roster-members.json` has not been regenerated.
  Run `npm run generate:roster-members` and redeploy Functions. Existing weeks gain them overnight
  while their first deadline is still ahead; weeks already past it keep the population they had, by
  design.
- **A member says their submission vanished** → it did not. Submissions are append-only, and the
  reviewer's by-day view flags who submitted after the initial deadline and who changed their answer
  since. Check the week's *Who is available* before assuming a fault.

---

## The Trains page's timetables

`trains.html` compares two Chiltern timetables held in one generated file, `trains-data.js`. Nothing
about it is live: it reads no network, and its times change only when somebody regenerates that file.
Every signed-in member can open it, and so can the staff PIN.

- **What it holds:** today's books, valid until Saturday 12 December 2026, and December's, valid from
  13 December 2026 to Saturday 15 May 2027 — both Chiltern's public timetables, every stop included.
  The generator still accepts the roster office's simplifier as a fallback for a side whose books are
  not out yet (it carries no stops).
- **When to regenerate:** whenever Chiltern issues new books — a correction, or the May 2027
  timetable, whose deadline is in `MAINTENANCE_CALENDAR.md`. The steps, and the figures the tests
  hold to the printed books, are in `docs/timetable-dec26/tooling/README.md`. If a hand-checked
  figure moves, check the books before changing the test: a new issue moves them legitimately, and
  a parser fault looks exactly the same.
- **Christmas and New Year are not in the books.** Chiltern's timetable page says it will still
  change times between 13 December and 10 January, "including significant changes over the Christmas
  and New Year period", so the overview says Christmas and New Year are not on the page until
  `FURTHER_CHANGES_UNTIL` (10 January 2027), then drops the note by itself. The note sits above the
  overview's fold, so it shows on every visit, not only the first.
- **Never commit the inputs.** The PDFs and the simplifier spreadsheets stay out of the repository
  (the tooling's `.gitignore` refuses them); the spreadsheets hold platforms, lengths and diagrams
  that are not passenger facts.
- **It turns over by itself on 13 December.** From the change the first column reads "Until 12 Dec",
  a typed time is looked up in the timetable that is running, and a new end reads "Now goes on to …";
  after `DEC_VALID_UNTIL` (15 May 2027) the page says both timetables have ended. Nothing to switch on
  the day — but check it live that morning (MAINTENANCE_CALENDAR).
- **A weekday's figures are a Tuesday to Thursday's.** A few of today's weekday trains run only on
  Mondays and Fridays, or only Tuesday to Thursday; counting every row counted one train twice. The
  train lists still show both, each with its days.
- **Coming back is timed at the station** the passenger gets on at, with the time into Marylebone
  as small print — so a member answering "when's my train back from Banbury?" reads Banbury's time.
- **Leaf fall.** Until 10 January Chiltern runs London-bound Amersham-line trains up to 3 minutes
  early (its autumn timetable): today's book carries that and December's does not, so those
  stations' cards say so coming back. `LEAF_FALL` in `build.py` — read it off Chiltern's timetable
  page for each autumn.
- **What the books print that a plain list of stops cannot**, and how the generator treats it —
  pick-up-only and set-down-only stops, "arrives 8 minutes earlier", buses, weekday versions that
  stop differently: the tooling README → "What each step knows".

### The one-off timetable push, and the final week's notice

Two reminders run themselves in the week before the change, and nobody presses anything:

- **Saturday 12 December 2026, 18:00 London** — `sendTimetableReminder` (functions/documents.js) sends
  ONE broadcast push to every subscribed device: "🚆 New timetable from Sunday", landing on the Trains
  page. It is a DAILY schedule with a one-date guard, so on every other evening it logs "Not the
  evening before the change — skipping" and does nothing. To confirm it went: the function's log says
  "Timetable reminder sent". To stop it beforehand, the reversible way: in the GCP console, Cloud
  Scheduler → the job Firebase created for it (named after the function) → Pause; the next Functions
  deploy re-creates the schedule enabled, so pause it again after any deploy before the 12th. The
  permanent way: delete `sendTimetableReminder` from the builder's return in documents.js and from
  `functions-surface.test.mjs`, and deploy. The next timetable change moves `TIMETABLE_CHANGE` there —
  the body's date follows it, and the headline's "from Sunday" is held to a Sunday by the test; until
  then the function is harmless.
- **6 to 12 December** — the Calendar notice `timetable-soon-2026` (calendar-notices.js) is offered to
  signed-in members, once each, and retires itself on the 13th. A member who sees the push and the
  notice sees the same message twice, which is the intent: the push reaches the phones with
  notifications on, the notice reaches everyone who opens the Calendar.

## The new link page

`newlink.html` shows colleagues the three shortlisted proposals for the new CEA link — **which starts
in January 2027, not with the timetable** (owner, 2 Nov 2026; the day not yet set, owner, 8 Nov 2026). It is **open**
since v25.60 to everyone on the normal CEA contract and the managers (owner, 9 Nov 2026: "send the new links section
live for everyone with a cea contract and the managers"). Before that it was a preview for the admin and the names in
`CONFIG.NEWLINK_PREVIEW` (`roster-data.js`), who still reach it by that list.

**Every setting is one line in `newlink-config.js`** — `CHOSEN`, `STARTS`, `TIMETABLE_STARTS`,
`CONTACT`, `CONTACT_ROLE`, `CLOSES`, `AUDIENCE`, `PHASE`, `PACK_BASE` and the "Have your say" lines — so
changing one never means touching the page. Each is an owner decision, recorded beside its line.

**When a design is chosen, name it in `CHOSEN`** — 'Balanced V6', 'Level Crossing' or 'Middle Ground',
spelt as the page shows it (owner, 10 Nov 2026: "Add a 'decided' state"). `PHASE` follows it to
'decided': the status card says the design has been chosen and when the link starts, and the page stops
asking for views — no "For discussion, not a decision", no Have your say. A name not on the shortlist is
refused, and `newlink-config.test.mjs` fails on it. **If nothing is chosen by the start (`STARTS`), the
page stops asking for views anyway** and says only that the contact will confirm the outcome; it never
names a design by itself. The page is open to the same people in every phase.

**Who is in charge is part of the wording.** The contact leads the change (`CONTACT_ROLE`, owner,
4 Nov 2026); the admin built the page and the tooling and is in charge of neither the change nor the
choice, so **no line may name the admin as deciding, recommending or collecting views**, and how the
choice is made is left deliberately vague. `newlink-config.test.mjs` and `e2e/newlink.spec.js` hold the
wording to both; the process is in LINKS_DEC2026_PLAN.md's dashboard, not in anything colleagues read.

**Who it is for: everyone on the normal CEA contract, and the managers; a CEA bilingual contract keeps its
own links** (owner, 8 and 9 Nov 2026). It goes by the contract, not the line: a normal contract on the bilingual
link is on the new link. Until `AUDIENCE` names the 26, the page stands in with every CEA whose `bilingualContract`
is not set. CES and Dispatchers are not on it.

**The gate is the `newlinkAudience` role in `auth-policy.js`**: a member with `role: 'CEA'`, no
`bilingualContract`, not `hidden`, or a name in `CONFIG.MANAGER_NAMES`. The `newlink` policy reads it, and so,
through `canOpenNewlink`, does the drawer's pill. It follows the roster, so there is no list to keep: **a new
starter on a normal CEA contract can open the page once they are on the roster, and a leaver loses it when
`hidden` is set.** It is written in `auth-policy.js` rather than read from `newlink-config.js`, because
`newlink-boundary.test.mjs` keeps the page's modules out of every roster page; `newlink-config.test.mjs` fails
unless the role and `audienceNames()` with the managers agree for every name. So **setting `AUDIENCE` to the 26
means changing the role in the same commit**, and closing the page again means `PHASE = 'preview'` and
`'newlinkAudience'` out of the `newlink` policy together, with the test's pinned decision.

**Letting somebody outside the audience in is one line**: add their name, spelt as the roster spells it, to
`CONFIG.NEWLINK_PREVIEW` in `roster-data.js`, then bump and release (S. Silva has been on it since the preview).
It is page access only — the page reads nothing from the server and shows only public files — so there is no
claim to set, no `npm run generate:roster-members` and no Set up accounts. `newlink-config.test.mjs` refuses a
name that is not an active member of the roster.

**Its PDFs come from the GitHub Pages mirror** (`PACK_BASE`), because Firebase Hosting serves nothing
under `docs/`. Retiring the mirror breaks those links — move the files into a served folder first. And
since the mirror follows the Hosting gate (10 November 2026), a `docs/`-only push republishes nothing
(`docs/**` is in the Hosting deploy's `paths-ignore`), so a changed PDF reaches the page only with the
next app release.

### When the new link starts — bringing it into the roster

**Never edit `weeklyRoster` in place, and never change `MAIN_ROSTER_WEEKS` or
`MAIN_ROSTER_REFERENCE_DATE`.** A roster pattern has no start date: `getBaseShift` reads one table for
every date, past and future, so an in-place edit redraws every day already worked. Simulated on
10 November 2026 with a shortlisted design's table, 5,433 of the 6,573 base shifts the main-link members had
between 1 January and 9 November 2026 came out different. It also re-judges every leave day recorded
without a `replacedType`, moving 2026's "taken" in the very weeks the January carry-back reads 2026's
remaining days as its cap, and "Fill from calendar" for a 2026 payslip moves too. Nothing errors;
`roster-data.test.mjs` ("a pattern in force is never edited in place") pins every existing week and
fails instead.

**Bring the link in as its own roster type, and move each colleague onto it with a dated
`rosterChanges` entry**, in one release:

1. **The table.** Add the chosen design's weeks to `roster-cycle-data.js` as a NEW export, copied cell
   for cell from its entry in `links-proposals.js`. Add the export to `validateRosterPatterns`' default
   list (`roster-data.js`), or nothing checks it. Every cell must pass that validator: RD, OFF, SPARE, a
   real `HH:MM-HH:MM` whose ends differ, or a bare Other flavour Monday to Saturday. Classify the export
   in `public-data-classification.test.mjs` (a shift pattern, public).
2. **Its length and reference Sunday** in `CONFIG` (`roster-data.js`): a `…_ROSTER_WEEKS` equal to the
   design's number of lines, and a `…_ROSTER_REFERENCE_DATE` at noon on a Sunday — the start Sunday is
   simplest — each classified in `public-data-classification.test.mjs`.
3. **The type, everywhere the five are named today:** `getWeekNumberForDate` (length and reference
   Sunday) and `getRosterForMember` (table, length, week prefix), both in `roster-data.js`, and the
   member check in `calendar-member.js` (its "Unknown rosterType" list). **An unknown type falls through
   to `main` silently**, so a missed branch draws today's link under the new name and nothing errors.
4. **The moves.** For each colleague who moves — by the owner's list, which goes by CONTRACT, not line:
   a normal CEA contract on the bilingual link moves too, and the `fixed` rows are the owner's call —
   ADD a `rosterChanges` entry `{ from: <start Sunday>, rosterType: '<new type>', currentWeek: <their
   line> }` after any existing ones. With the reference Sunday set to the start Sunday, `currentWeek` is
   simply the line they start on (it is REFERENCE-ANCHORED: `.claude/rules/roster-data.md`). Leave each
   member's base fields and `weeklyRoster` exactly as they are: they draw every date before the start.
5. **What reads the main link by name:** the Links workspace seeds from `weeklyRoster`
   (`links-seed.js`, `links-app.js`). Decide whether it should seed from the new table; leave
   `weeklyRoster` in place either way.
6. **Before releasing:** check that every member's base shift on every date before the start Sunday is
   unchanged (snapshot and compare), that each mover's first week reads their line, and that the new
   type is in the `ROTATING` set of `roster-data.test.mjs`'s "no two rows hold one rotating line" test;
   then the suite must pass. No `npm run generate:roster-members`: the server copy carries no
   `rosterChanges` and no pattern.

### Keep only the shortlist (Links)

A one-off for the admin, in the Links workspace's ··· menu: **Keep only the shortlist** moves every design last saved
before 2 Nov 2026 to Recently deleted, so the picker offers the three built-in, read-only proposals. The dialog lists
each design and who last saved it before anything moves. To undo one, restore it from Recently deleted: a restored
design carries a new save time, so it is never offered again. The row disappears by itself once nothing older is left.
The reasoning, including why it is a press and not something that runs on page open: `links-shortlist.js`.
