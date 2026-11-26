# Operations Reference — MYB Roster App

*Last updated: November 2026 — v26.90 · Updated every 0.10 version*

How the app is run day to day: the steps and facts an operator or an editor needs. Referenced from
`CLAUDE.md`. What changed at which version is in git, not here.

---

## Huddle ingest — full detail

### Firebase Storage

Files are stored at a **versioned** path, `huddles/YYYY-MM-DD-{uploadId}.pdf` (or `.docx`), recorded in
the document's `storagePath`. The random suffix lets a re-upload for the same date (a PDF↔DOCX swap
included) write the new object before the old one is deleted, so nothing is orphaned and nothing races
the Firestore commit. Older documents with no `storagePath` used the fixed `huddles/{date}.{fileType}`;
the cleanup falls back to it and the prune reclaims those as orphans.

**Storage URL strategy:** `ingestHuddle` stores a permanent `firebaseStorageDownloadTokens` URL in
`storageUrl`, never a signed URL — GCS caps v4 signed URLs at 7 days, far short of the 3-month Huddle
retention. Members open the file through a 15-minute signed link from `getDocumentUrl` when one can be
minted, with the stored URL as the fallback (AUTH_PLAN.md §5). The stored form:
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD-{uploadId}.pdf?alt=media&token={uuid}
```

**Auto-prune (3 months):** at the end of every successful `ingestHuddle` run, `pruneOldHuddles()`
(`functions/huddle-retention.js`) deletes Huddle documents and their Storage objects older than
`HUDDLE_RETENTION_MONTHS`. It re-reads each document in a transaction and leaves it alone if a
replacement has moved its `storagePath`, then deletes only that version's object. Other objects under
`huddles/<date>` are reclaimed by `sweepHuddleOrphans` only when over a day old and named by no live
document (that module's header has the race). It is awaited but best-effort: a failure never blocks the
upload response. Huddles keep 3 months, Circulars and Newsletters 6 — Huddles are higher-volume and
rarely read after the day.

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date). The fields are **`docs/DATA_MODEL.md` → huddles**, their
one home. Two operational points: `uploadedBy` is `"power-automate"` for the Cloud Function and a member
name for a manual admin upload; and `htmlContent` (the DOCX converted to HTML by mammoth.js at upload)
is absent for a PDF, for a conversion over `MAX_HUDDLE_HTML_CHARS` (200,000 characters), and for a Word
file over 2 MB (`MAX_DOCX_CONVERT_BYTES`, `functions/huddle-ingest.js`) or one whose conversion failed.
The viewer then falls back to the file.

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

- **Why a plain-text body:** Power Automate's `@{body('...')?['contentBytes']}` substitution inside a
  JSON body silently truncates large base64 strings. The file goes in the raw body; metadata in headers.
- **Body reading:** `req.rawBody` first, then streaming. Never add an Express body-parser — it consumes
  the stream.
- **File type** comes from the `X-Huddle-Filename` extension, never `Content-Type` (Power Automate sends
  `text/plain` for both).
- **A 500 does not always mean nothing was stored.** A record write can land and its answer be lost; the
  function reads the record back and, finding its own upload, finishes as usual (stored, announced, 200).
  Only if Firestore stays unreachable through the retries and that read does it answer 500 with the
  Huddle possibly in the app — and nobody told, because Power Automate's retry finds the record and
  stays silent as a re-send (`functions/huddle-ingest.js`).

### Secret setup (one-time, requires firebase-tools)

```bash
firebase login
firebase use myb-roster
firebase functions:secrets:set HUDDLE_SECRET   # paste a strong random UUID
cd functions && npm install
```

Generate a secret: `node -e "console.log(require('crypto').randomUUID())"`

Find it in Firebase Console: Build → Functions → Secret Manager (or Google Cloud Console → Security →
Secret Manager, project `myb-roster`).

### Power Automate flow — "huddle ingest"

Uses the **HTTP** (Premium) connector — not "Send an HTTP request (Office 365)".

**Trigger:** "When a new email arrives (V3)" on the Huddle mailbox, filtered to emails with attachments.

**Priority:** DOCX is preferred — it converts to HTML server-side and renders inline in the app. PDF is
the fallback if no DOCX is attached. The choice is an attachment-type check, never a time-of-day
condition.

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

**1. Expression tab vs value tab** — getting this wrong silently breaks the flow:

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

**2. Filter array returning empty — the most common failure.** `body('find_docx')[0]` on an empty
result throws "array index 0 cannot be selected from empty array"; the nested length checks prevent it —
never reference `[0]` outside a condition that guards it.
- The left side of the filter condition must be on the **expression** tab (the value tab compares a
  literal string).
- The DOCX MIME type is 71 characters and easy to mistype — copy it exactly:
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- "From" must reference `triggerOutputs()?['body/attachments']` directly.

**3. London timezone.** The Compose action must be named `London_time` (underscore — a space causes
`InvalidTemplate`). The expression **must include the `'yyyy-MM-dd'` format argument**: without it the
full ISO datetime fails `ingestHuddle`'s `^\d{4}-\d{2}-\d{2}$` check with HTTP 400, on every request,
silently.

```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'], 'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
```
Note: `'GMT Standard Time'` has spaces — `'GMTStandardTime'` is invalid.

**4. `@{}` syntax in the value tab** — use `@{expression}` for dynamic values in header and body fields;
do not switch to the expression tab.

**5. HTTP action body** — it cannot reference a Compose action by name inside its own inputs; always
prepare the value in a separate Compose action first.

### Firestore Security Rules — `huddles` collection

**Read requires access, write is admin-only.** A read needs a bound member identity or the admin claim;
the client also refuses the read at source while locked (`calendar-doc-access.js`). Browser writes (the
manual admin upload in `huddle.js`) need the admin claim, and the rule shape-validates them (`hasOnly`
fields, a bounded date, `fileType in ['pdf','docx']`, a 250,000-character `htmlContent` cap, an
admin-only delete). `ingestHuddle` uses the Admin SDK, which bypasses rules. `storage.rules` requires the
admin claim for Huddle file writes. **The live `firestore.rules` is the authority — don't quote it here.**

### Huddle notification tap behaviour

**The route.** On a notification tap the service worker's `notificationclick` **re-bases the payload's
route onto its OWN scope** (`registration.scope`) and opens it with `focusedClient.navigate()` or
`clients.openWindow()` — `https://myb-roster.web.app/#huddle` on a Hosting install,
`https://garethdavidmiller.github.io/roster-app/#huddle` on the mirror. The Cloud Function sets one
`STAFF_SITE_URL` (the canonical origin), so only the payload's trailing page and hash are used. **Never
fall back to the bare origin** — that caused the 16 Jun 2026 notification 404. On load, or on
`hashchange` if the page is open, `calendar-huddle-viewer.js` runs `_triggerAutoOpen(huddle)`. The
drawer's **Daily Huddle** link uses the same `#huddle` hash and the same path.

**Two render paths inside `_triggerAutoOpen` — do not unify:**

| `htmlContent` | Behaviour (identical for the drawer link and a notification tap) |
|---------------|--------------------------------------------------------------------|
| Present (DOCX converted server-side) | Renders sanitised HTML inline in the viewer overlay |
| Absent (PDF, or DOCX conversion failed) | Shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); tapping it calls `window.open(url, '_blank', 'noopener')` with the short-lived `getDocumentUrl` URL minted when the button was drawn — or the stored `storageUrl` if none has arrived by the tap, or if the signed one names a different file than this Huddle's `storagePath` |

**Why the button.** A notification tap gives the page no user activation, so `window.open` is
pop-up-blocked, and `window.location.href = storageUrl` would navigate the standalone PWA to a
cross-origin URL (Android wraps it in browser chrome and the app window is lost). Tapping the button IS
a gesture: the file opens as an Android Custom Tab over the intact app, and Back returns to it. So both
triggers always open a file through the button — **never a direct `window.open`/`location.href` at open
time**.

**Behind a sign-in (owner decision, 7 Sep 2026).** The notification carries no document content, but
the tap-through needs access: the viewers consult `calendar-doc-access.js`. A tap on a locked device
lands on the sign-in card with the tap HELD, and signing in opens the Huddle; no read, cached or live, is
issued while locked. A read-tightening like this ships client-first, then the rules.

**The Huddle is not printed (owner decision, 7 Sep 2026).** Printing with the viewer open gives a short
notice: the viewer is `position: fixed` over a scrolling body, so a long plan would reach paper
truncated with nothing saying so. Closing the viewer prints the calendar as normal. A PDF Huddle opened
in the browser's own viewer prints like any file.

**Push notifications paused?** If `HUDDLE_PUSH_PAUSED` is `true` in `functions/documents.js`, ingestion
succeeds but no push is sent. To re-enable: set it to `false`, redeploy Functions, and check
`STAFF_SITE_URL` (`functions/index.js`) is the bare `https://myb-roster.web.app` origin — no
`/roster-app` sub-path is needed, because the service worker re-bases onto its own scope.

**Did a broadcast reach anyone?** Cloud Logging, for the sending function (`ingestHuddle` or
`onHuddleCreated`, `onCircularCreated`, `onNewsletterCreated`, `sendTimetableReminder`): the transport
logs `Fan-out complete — N of M subscription(s) accepted`, and the sender `… — N subscription(s)
accepted`, or the warning `… — no subscription accepted it` when N is 0. Accepted means the push service
took it, not that a phone showed it.

---

## Weekly Roster Upload — full detail

### Cloud Function — `parseRosterPDF`

**The parse's contract — every defence against a week written onto the wrong days, what a blank cell
means, the review's states and controls — is `.claude/rules/roster-import.md`. Read it before changing
anything in the import.** This section is the request/response reference and the review pipeline.

- **Region:** `europe-west2` (London).
- **Auth:** a Firebase ID token (`Authorization: Bearer <idToken>` from `auth.currentUser.getIdToken()`),
  validated by the Admin SDK, with the admin custom claim required. There is no shared roster secret.
- **CORS:** `cors: ADMIN_FUNCTION_ORIGINS` (`functions/index.js`) — `https://garethdavidmiller.github.io`,
  `https://myb-roster.web.app`, `https://myb-roster.firebaseapp.com`. Defence-in-depth on top of the
  token; add any new hosting domain there. (`ingestHuddle` keeps `cors: false` — server-to-server.)
- **AI model and settings:** `MODEL_REQUEST` in `functions/roster-prompt.js` (model, thinking,
  `max_tokens`), sent as one non-streaming `messages.create` through `@anthropic-ai/sdk`,
  `timeoutSeconds: 120`. Its header holds the reasoning (why thinking stays off as far as the model
  allows, why the model ID is complete as written, why a newer API version is a migration).
  `index-endpoints.test.mjs` pins the request shape; a refusal is reported as a decline
  (`DECLINED_ERROR`), not an unreadable answer. **Re-enabling thinking through streaming failed in
  production** (v16.27, rolled back at v16.28); day-column accuracy rests on the server-side defences.
- **The defences, one line each** (the contract is `.claude/rules/roster-import.md`): the sheet's own
  printed week (`functions/roster-week-heading.js` — a `Week Ending` heading naming another Saturday
  than `X-Week-Ending` refuses the PDF whole); `applySundayScanCorrections` and
  `applyColumnScanCrossCheck` on the server; `assessRosterAlignment` (`roster-alignment.js`) on the
  client, which refuses the whole read when three or more members drift the same way; and the PDF's own
  grid (`functions/roster-geometry.js`), which refuses an AI day in a physically EMPTY cell. **The row
  read and `columnScan` are not independent witnesses** (one model, one PDF, one call); the grid is the
  strong witness. When the grid places every member, cells are extracted by coordinate and the model
  only normalises them (`buildCellTable`) — it is sent no PDF; one unplaced name, a day header not read
  Sunday to Saturday, or one row matched by two members falls the whole document back to the PDF path.
- **Why direct PDF input on the fallback path:** text extraction destroys the table's columns; the model
  reads the visual layout.

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

- **`crossCheck`** — `"complete"` (every member re-verified against a second, column-by-column reading —
  same model, same PDF, same call, so **not** an independent witness), `"partial"`, `"unavailable"` (the
  AI omitted or garbled `columnScan`), or `"not-applicable"` on the geometry path. The review shows an
  advisory note unless it is `"complete"` or `"not-applicable"`.
- **`missingMembers`** — members of this `rosterType` with NO row returned (a dropped row OR a genuine
  absence); listed on the review so a dropped member is visible.
- **`duplicateMembers`** — members with MORE THAN ONE row (`repeatedMembers`, `functions/roster-prompt.js`).
  Only the first non-empty row is used (`memberRows`; a real Dispatch sheet prints an empty placeholder
  above the real row), and the review asks the admin to check each against the PDF. Absent from an older
  Function's response = none.
- **`choices`** — the two candidate readings for each cell the cross-check flagged, keyed
  `"memberName|date"`, so the review offers a pick instead of a dead "couldn't read" row.
- **`geometry`** — `{ status, checked, total, pagesRead, pagesRejected }` for the grid witness:
  `"complete"`, `"partial"` (the rest are named in the Functions log as unmatched) or `"unavailable"` (no
  grid, no text layer, `pdfjs-dist` absent, or nobody matched). This IS an independent witness — the
  file's coordinates, not the model — counted over the rows the admin will see.
- **`geometryRefused`** — names whose rows the witness refused (a claim in an empty cell), filtered to
  names on the review. `assessRosterAlignment` starts such a row unticked with its own wording and counts
  it toward the three-member breaker; the refused cells are already `UNKNOWN|…` in `parsed`.
- **A sheet for another week** — `409 { "error": "This roster is for the week ending Saturday 12 September 2026, but the week chosen is Saturday 5 September 2026. Choose the matching week and upload it again.", "sheetWeekEnding": "2026-09-12" }`,
  shown after "Couldn't read the roster:". A PDF printing two different weeks is refused with "Upload one
  week's roster at a time." No heading read (no text layer, another layout, a non-Saturday date) refuses
  nothing; the Functions log says "the sheet's own week was not checked: …".

### What the roster codes mean (do not weaken without testing)

The code table the model is given is `SHIFT_VOCABULARY` in `functions/roster-prompt.js` — the ONE copy
both prompts interpolate, held to `normaliseShift` in both directions by `roster-prompt-parity.test.mjs`.
One line each (the reasoning is `.claude/rules/roster-import.md`):

- **RDW cells:** the AI returns `"RDW HH:MM-HH:MM"` — **never strip RDW from the return value**.
- **`AL`, `A/L`, `A.L.`** → `"AL"`. **`SP` / `SPARE`** → `"SPARE"`. **`OFF`** (CES and bilingual rosters) → `"RD"`.
- **Absence:** `SC` (sick on a day the person WAS booked to work), `HA` (hospital appointment), `OD` (paid absence / long-term sick marking), `ML` (maternity leave) and `CL` (compassionate leave) → `"SICK"`, which the app calls Absent. **`SN` is NOT `SC`**: sickness on a day the person was NOT booked to work, so the day stays the rest day it was → `"RD"` (owner, Sep 2026).
- **`NA` / `N/A` and `NS`** (not available) → **a rest day, on every day, Sundays included** (owner, 6 Nov 2026). Weeks imported between 24 Sep and 6 Nov 2026 hold their NA days as Absent; they change only when that week's roster is uploaded again.
- **The Other family** (OTHER_DAYS.md): `TRG`/`TRAINING`/`TRAIN` → `"TRG"`; `INDUCTION`/`IND` → `"IND"`; `ASSESSMENT(S)`/`ASSESS` → `"ASSESS"`; `TEAM DAY`/`TEAM` → `"TEAM"`; `UNION COURSE`/`UNION` → `"UNION"`; `MTG`/`MEETING` → `"MEET"`; an RDW marker either side becomes `"FLAVOUR RDW"`. Saved as `type: 'other'` with the value verbatim. **A meeting is always a meeting** and keeps printed times in either order (`"10:00-14:00 MTG"` → `"MEET 10:00-14:00"`); a meeting cell it cannot read goes to review. Any other Other cell WITH times goes to review when the code comes first; written time-first it imports as a plain shift — a known gap. **A training or meeting day on a Sunday is never recorded** (GUARDED); one printed WITH times is rest-day working at those times.
- **Cell layout is decided by CONTENT, never by line POSITION.** A duty/diagram code (`"CEA 16"`, `"D24"`) is ignored *wherever it appears*; a status code (`AL`, `SPARE`, an absence code) is the cell's value *wherever it appears*, second line included. A line-position rule once silently discarded annual leave. Pinned by `roster-prompt-parity.test.mjs`; never reintroduce one.
- **A blank cell means different things on different days.** A blank Sunday is `RD`, never a copy of Monday. **Mon–Sat is the opposite**: the rosters state an unworked weekday explicitly, so a blank is a cell nobody read and becomes an UNREADABLE review row. Expect a handful where a member works only part of the week on a SECOND roster — defaulting them to RD would overwrite the other import. Explicit `RD`s from the roster office make those rows go away. When a row's Monday to Saturday were all unread, its Sunday is a question too.
- **A worked Sunday carries no RDW marker and is never suspicious for lacking one** — Sunday is uncontracted, so its work is inherently overtime.
- **A code not in the table is never read as a rest day** — it reaches the admin as an UNREADABLE row with the raw text.
- **Leave, an absence or an Other day on a Sunday is never recorded; a SPARE or an Other day on 25 or 26 December is never recorded (any year); and leave or an absence on a base REST day is recorded only when the admin answers that it was a swapped working day** — all arrive as GUARDED rows, never silently. Full-pay absence applies only to rostered days. Mirrors CLAUDE.md "Sundays are non-contracted".

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
                    Sunday, a SPARE or an Other day on Christmas Day or Boxing Day, or anything but a rest day before
                    the member's start date. Shown and explained, never silently dropped. Leave or an absence on a rest
                    day ASKS "Was it a swapped working day?": only "Swapped — record it" writes (stamped
                    `replacedType`); "Rest day — leave it" writes nothing and clears an earlier record
                    on that day; unanswered writes nothing. "Skip all" takes an answer back. On 25 and
                    26 December from 2026 nothing is asked: the app's Christmas leave decides those
                    days, and an earlier import there is offered as an unticked "Back to normal"
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
  • the ORIGINAL PDF stays reachable from the review as a DOWNLOAD, not a new tab: a blob: document
    inherits the page's CSP, and `object-src 'none'` blocks Chrome's PDF viewer. The object URL is
    created at CLICK time and revoked on a timer (an immediate revoke cancels the download on Android)
  shiftDisplay(shiftStr, date)
    — "RDW|" prefix → 💼 RDW badge + time; a timed Sunday → RDW (Sundays are uncontracted)
    — an Other day shows its RDW marker and times beside the badge
    — an UNKNOWN| value → "couldn't read …"
        ↓
Apply approved changes — saveRosterWrites (roster-import-save.js), in parts of up to 450 writes:
  shiftValueToOverrideType(value, date) → Firestore type field (roster-cell-rules.js)
    — date detects Sunday: worked times → 'rdw'; AL/SICK → 'correction' (RD) backstop
  Strip "RDW|" prefix → save plain time as value
  source: 'roster_import' on all saved docs
  A part that only adds records is a plain batch. A part that DELETES one ("Use new roster", a stale
  import cleared, an older copy of a day) is one transaction, refused — writing nothing, naming the
  days — when a record it deletes changed after the roster was read. The review then reads the week
  again; every other row keeps its answer (KNOWN_LIMITATIONS.md → "Two editors on one day").
```

---

## Weekly Retail Circular and Marylebone Newsletter — full detail

### Overview

Two document flows with identical mechanics: the admin uploads a PDF or Word (.docx) file on the
Operations page, and staff open the latest from the drawer. One upload engine, `documents-client.js`
(`firebase-client.js` re-exports the entry points).

**The Newsletter's ☰ button shows only while its latest issue is under six weeks old** (owner,
14 Nov 2026; `newsletter-recency.js`). **Set the date to the issue date**: the six weeks count from it,
and the latest is the one with the latest date. A recent upload appears on the uploading device at once
and on others at their next Calendar open; an older issue is filed but never offered, and the receipt
says so. Its notification opens it whatever its age (`#newsletter`). Why: DECISIONS.md → "The
Newsletter button follows its latest issue".

### Upload flow (admin, Operations page)

1. Operations → expand **Weekly Retail Circular** or **Marylebone Newsletter**.
2. Choose the date (capped to today; only the Huddle's card allows tomorrow, through `doc-upload.js`'s
   `maxDateOffsetDays`).
3. Choose a PDF or Word (.docx) file and press **Upload**.
4. `uploadCircular` / `uploadNewsletter` (`documents-client.js`) write the file to a versioned path
   (`circulars/{date}-{uploadId}.{ext}`, `newsletters/{date}-{uploadId}.{ext}`), upsert
   `circulars/{date}` / `newsletters/{date}` with `{ date, storageUrl, storagePath, fileType, uploadedAt,
   uploadedBy }`, delete the previous file at the old `storagePath` only after that commit, and start the
   6-month prune without waiting for it.

A re-upload for the same date replaces both, the old file going after the new document commits.
Documents from before `storagePath` existed are found through `legacyDocPath`
(`{collection}/{date}.{fileType}`, using the OLD document's own `fileType`, so a PDF↔DOCX swap still
finds the previous file).

### 6-month auto-prune

`pruneOldDocs` in **`doc-retention.js`** is the browser's only destructive operation on shared data —
read its header before relying on this summary:

- **It needs SERVER time** (read back from the just-written document's `uploadedAt`) and skips the whole
  sweep without it. Never a client clock: a device running months fast would delete months of current
  documents. The next upload runs it again.
- It deletes documents dated before `sixMonthCutoffISO` (`storage-utils.js`), never the date just
  uploaded, and **only what it read**: each delete re-reads in a transaction and stands down if the
  `storagePath` has moved ("changed since the query — left alone").
- The Storage object goes only after that commit. Failures are logged per document and never thrown, so
  a failed prune never blocks an upload. `doc-retention.test.mjs` drives the race with a competing
  writer.
- It is not scheduled: if uploads stop, nothing prunes (KNOWN_LIMITATIONS.md → "The document FILES are
  protected by a bearer URL, not by auth").

### Staff access flow

1. Staff tap ☰ → **Weekly Retail Circular** or **Marylebone Newsletter** (the Newsletter only while its
   latest issue is under six weeks old).
2. A visitor without access (`canReadDocuments()`) is asked to sign in, and no tab opens. The Calendar,
   Overtime, Pay and Trains pass their own check; every other page takes `initNavPanel`'s default, a
   named member.
3. A blank tab is opened **synchronously** in the click (`window.open('', '_blank')`) — required for
   Safari/iOS to allow it.
4. The latest document is read, and a short-lived URL requested from `getDocumentUrl` in parallel,
   against an 8 s budget (`DOC_FETCH_BUDGET_MS`). The tab is sent to the short-lived URL, or to the stored
   `storageUrl` when none came or it names a different file (`resolveDocumentOpenUrl`). A `.docx` goes
   through Microsoft's Office Online viewer (`officeViewerUrl`). With no document, or a failed read, the
   blank tab closes and a lightbox says so (with a retry message on a failure).
5. Rapid repeat taps are ignored while a fetch is in flight (`_docFetching`).

### Security

| Operation | Requirement |
|-----------|-------------|
| Reads | Require access, as the Huddle does: a bound member identity or the admin claim. The client refuses at source behind a sign-in (`calendar-doc-access.js`). Files open via a short-lived `getDocumentUrl` URL — used only when the path it signed matches the document on screen — falling back to the stored `storageUrl`, a tokenised bearer URL (ARCHITECTURE.md EXC-007). |
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

Every Huddle, Circular and Newsletter file has a permanent download link (`storageUrl`) carrying a key:
whoever holds a copy — a browser's history, a forwarded message, Microsoft's Word viewer — opens the file
with no sign-in (ARCHITECTURE.md EXC-007). **Operations → Document links** gives every file a new key, and
every old copy stops working at once. Staff notice nothing: the app opens documents through a 15-minute
link signed from the file's PATH, and each record is moved onto the new key before the old one goes. The
owner asked for one run when it was built (12 Nov 2026, DECISIONS.md); ARCHITECTURE.md EXC-007 records
whether it has been made.

**When:** a document link has been shared somewhere it should not be — or on a schedule, if one is ever
wanted (AUTH_PLAN.md §5).

**How:**
1. Operations → **Document links** → **Check the links**. This only counts: files in use; documents whose
   stored link no longer opens their file (a run mends each); older files no record uses (their link is
   switched off; the file is never deleted); documents whose file is gone; and stored links it cannot
   read. An unused file from the last day keeps its link (its document may still be saving); a check the
   next day offers it.
2. **Replace the links**, then confirm.

| The card says | It means | Do |
|---|---|---|
| Done. N files have new links | every old copy of those links is dead | nothing |
| N files couldn't be changed, and their old links still work | a write failed; each such file stopped at the step it reached, its stored link still working | press Replace again — safe |
| N files changed while this ran | an upload, or a run in another tab, landed mid-run; those files were left alone | Check again, and Replace if it is offered |
| N documents' links no longer open their files | each stored link names a key its file no longer carries — a document saved after a run had taken its file's key away. Staff still open the document through the app's 15-minute link; only the fallback is broken | press Replace — a run gives each one a working link |
| N documents whose links no longer opened their files now have working links | the run moved each of those stored links onto its file's new key | nothing |
| N files from the last day aren't used by the app, so their links were left working | an upload may still be saving the document that names them; a run takes the key only from an unused file at least a day old | Check again tomorrow, and Replace if it is offered |
| N files are left as they are, old links and all | a stored link this cannot read may open them, and touching them could break it | the unreadable links need looking at in a session; the card cannot fix them |
| N files couldn't be checked, so it isn't known yet whether there is anything to replace | the check could not read those files' keys; nothing changes on a check | Check again in a minute |
| It isn't known whether it finished | the answer was lost — a timeout, or the platform's own error | press Replace again — safe |
| Couldn't read the documents, so nothing was changed | the records or the file listing could not be read | try again in a minute |
| Couldn't replace the links: the request was never sent | the page could not get the admin's sign-in token, so nothing left it | check the connection, then press Replace again |
| Couldn't check the links: the server answered 404 | `rotateDocumentLinks` is not deployed | check the latest "Deploy Firebase Functions" run, then Check again |

**Why pressing it twice is safe:** a run only issues fresh keys and moves each record onto its file's
newest one; every key write is a compare-and-set against the file as read, and a record moves only while
its link is exactly the one read, so a run cannot overwrite an upload or another run. A refused write is
read back before it is called a change. The rules: `functions/doc-link-rotation.js`. **Logs:** one
counts-only line per run in the `rotateDocumentLinks` function log.

---

## Firebase Auth — full detail

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

The `@myb-roster.local` domain is synthetic — not real addresses; Firebase Auth accepts the format.

**Three copies of the email rule, kept equal:** `nameToEmail` / `normaliseSurname` in `auth-identity.js`
(re-exported by `firebase-client.js`), the CommonJS twin in `functions/roster-parse-helpers.js` (Cloud
Functions cannot import browser modules), and `memberEmailFor` in `firestore.rules` — a mismatch with the
rules copy locks that member out. `surname-parity.test.mjs` pins the first two, and the rules suite's
whole-roster test in `firestore.rules.test.mjs` the third. The rules engine's `lower()` lowers A–Z only,
so `memberEmailFor` maps İ (U+0130) and the Kelvin sign (U+212A) by hand; the rules suite pins six such
names.

**The default password:** the surname, lowercase, letters only, **padded to at least 6 characters by
repeating it** (Firebase's minimum — `"tuck"` → `"tucktu"`). The single source is `surnamePassword` in
`auth-identity.js`. `ensureFirebaseSession()` uses it to re-establish an un-migrated member's session on
load. The client never CREATES a missing account: only Operations → Set up accounts provisions one.

**Chosen passwords (PASSWORD_DESIGN.md — Track C).** A member can set their own in Settings → Password,
after which the surname no longer works for them. Sign-in tries the typed value, and when it spells the
member's surname it tries the surname default first (`credentialCandidatesFor` →
`ensureFirebaseSession`). Migration state (`passwordSetAt` vs `resetAt`) lives in `passwordStatus`.

**Admin break-glass — Operations → Account status → Reset** (`resetMemberPassword`). It sets the password
back to the surname default (`nameToPassword`, the functions-side twin of `surnamePassword`, held equal
by `surname-parity.test.mjs`) and revokes the member's sessions. There is no email-based self-service
reset yet.

- **A DISABLED account is refused** — a reset would leave it unable to sign in. The reset-request card
  marks it "Account disabled — run Set up accounts", which re-enables it on the surname default.
- **The member is told** on their own devices: `🔑 Password reset — set a new one`, never naming the
  password (a push renders on a lock screen) — unless *Their phone is lost or stolen* is ticked (below,
  step 5). If no notice reaches them, the reset still stands and Operations says so: **tell them
  yourself**, because they have been signed out everywhere with no idea why.
- **Signed out means signed out:** a silent sign-in on a session older than the reset is refused
  (`sessionPredatesReset`, `auth-identity.js`), so every device must type a password
  (AUTH_AND_SESSIONS.md 23).

### Locked-out member → reset request queue

The one flow that starts with **no identity at all**, so it runs through the only public unauthenticated
endpoint rather than a client write. Design and accepted risks: `PASSWORD_DESIGN.md` §12–§14.

1. **Member** taps "Can't get in?" on the login overlay (always there, under Sign in) →
   `requestPasswordReset` (`account-calls.js` — the one account call that sends **no** token) → the
   `requestPasswordReset` Cloud Function.
2. **Function** upserts `resetRequests/{memberName}` — `requestedAt`, `count`, `provisioned`, `disabled`
   (no account, or a disabled one, means the remedy is **Set up accounts**, not Reset). Keyed by member
   name on purpose, so the collection cannot outgrow the roster; the name must be on the server-owned
   roster (`processMembers`), and **no free text is ever stored**.
3. **Admin push** — a genuinely recorded request (never a throttled repeat) sends
   `🙋 Reset requests — N waiting` to the **admin's devices only** (`sendTargetedPush`, never
   `fanOutPush` — `.claude/rules/notifications.md`), opening `operations.html#reset-requests`. A burst
   within five minutes rings once. The push is a courtesy — the Firestore row is the doorbell.
4. **Admin** acts in Operations → Password Reset Requests (Reset, or Set up accounts where the row says
   *No account yet* or *Account disabled*), then clears the row (`clearResetRequest`). **A request proves
   nothing about who sent it** — confirm with the member first (PASSWORD_DESIGN.md §13). No client, the
   admin included, can create or update a request; only the function writes.
5. **The member is told, on their own devices.** `resetMemberPassword` sends
   `🔑 Password reset — set a new one` via `sendTargetedPush`, opening `settings.html` at the Password
   card. **The new password is never in the payload.** Read **`notified`** beside `revoked` and
   `stamped`: the password has already changed by then, so a push failure never means the reset failed,
   and any reset nobody was told about is your cue to reach the member another way.

   **A lost or stolen phone: tick the box.** "Their phone is lost or stolen" (unticked by default) sends
   no notice — it would land on that phone's lock screen — and deletes every push record the account
   owns; the result says so, or that the records could not be removed and to reset again with the box
   ticked. **Tell the member yourself.** The password is the surname default afterwards and the sign-in
   card names it, so ask them to sign in on another device and choose a new one promptly — until then,
   whoever holds the phone could type it too.

A device that subscribed before `owner` was stamped on subscriptions needs nothing doing: `notif.js`
re-saves the record with its owner at the next load.

### Sign-in statistics

Operations → Usage shows an **exact** count of accounts signed in, from `getSignInStats` (admin-only),
which reads Firebase Auth's own `lastSignInTime` — nothing new is stored. It is filtered to the current
server-owned roster (so an un-swept leaver cannot inflate it) and returns four integers, no identity. It
measures **sign-ins, not activity**: sessions last 60 days, so most opens are restores, and only the last
sign-in is kept. `neverSignedIn` is the actionable figure.

### Which address staff are on

While the app is served from both `myb-roster.web.app` and the GitHub Pages mirror, the Usage card's
**Which address staff are on** section is the only record of how far the move has got: member-devices
per address over the last 30 days, each on its latest active day, with the share that opened the
**installed app** nested in each bar and stated beneath it ("9 of 24 on GitHub Pages" is the figure a
retirement decision needs).

- **What it cannot see:** it counts OPENS, so an install nobody has opened in 30 days is invisible — the
  people a migration strands. Someone using both addresses counts on each. A signed-in admin's loads are
  excluded (KNOWN_LIMITATIONS.md → "The Usage counts are a trend" says why the figures stepped up when
  the staff PIN went).
- **Why it matters:** an installed PWA launches from its own cache and will not drift to the new address
  by itself, and anyone who moves loses their Pay Calculator figures (localStorage is per-address) unless
  they carry them across first with **Move Your Pay Data**.

---

## The Error Log notification (the admin's phone only)

**What it does.** When new entries reach Operations → Error Log, the admin's phone is told once —
`🐛 Error Log — 3 new`, "1 error and 2 slow saves. Tap to open the Error Log." — opening Operations at
the Error Log card (`operations.html#error-log`), and re-reading the log if the page was already open.
Added at the owner's request on 13 November 2026 ("only for my login the master admin").

**Who gets it.** The admin only: the name in `roles.admin` of the server-owned `roster-members.json`, on
an enabled account with the `admin` claim, on each device where that login turned notifications on
(Settings → Notifications; on an iPhone, only in the installed app). Sent with `sendTargetedPush`, never
`fanOutPush`, so it cannot reach anyone else.

**What it never says.** Counts only — no name, page, version or message (a notification shows on a lock
screen).

**When.** `sendErrorLogNotification` (Cloud Scheduler, europe-west2) checks every 15 minutes and sends
**at most one notice an hour**, counting everything since the last notice a device took; entries
resolved by the check are not counted. A notice covers the first hundred new entries, and says "N+ new"
when more are waiting. **The first check after deployment sends nothing** — it sets the starting line, so
existing entries are never announced.

**If a notice never comes:**
- Check notifications are on for the admin login on that phone (the Settings card says).
- Cloud Logging, function `sendErrorLogNotification`: each notice logs `[errorLog] N error(s), N slow
  save(s); N device(s) accepted`. `not an enabled admin account, so not told` means the account or claim
  is wrong — run Operations → Staff Login Accounts → Set up accounts. `the notice reached no device`
  means no subscription took it; the entries are counted again an hour later.

**To stop it.** Turning notifications off on a phone stops it there. Pausing its job (GCP console → Cloud
Scheduler → the job named after the function → Pause) stops it everywhere, but only until the next
Functions deploy re-creates it. To end it for good, remove `sendErrorLogNotification` from the builder's
return in `documents.js` and from `functions-surface.test.mjs`, and deploy.

**What it costs.** About $0.10 a month while it is the fourth Cloud Scheduler job (three are free per
billing account); free again when the timetable reminder retires. Its 96 runs a day sit far inside the
free allowances. Rules: `functions/error-log-notice.js`; sender: `functions/error-log-notify.js`; its
record: DATA_MODEL.md → `errorLogNotice`.

---

## When "Deploy Firebase Functions" fails at "Audit production dependencies"

The Functions deploy refuses to ship while `npm audit --omit=dev` in `functions/` reports a high or
critical advisory (`scripts/audit-functions-deps.sh`). It can fail on a day nothing changed, because
advisories are PUBLISHED against packages already installed. Nothing deploys, so the live functions stay
on the previous release; Hosting is unaffected.

**The fix:** in `functions/`, `npm audit fix --omit=dev` (never `--force`, which can downgrade a major),
check the lockfile diff is patch or minor releases only, run `npm run test:functions`, bump the version
(CI counts `functions/package-lock.json` as served) and merge. The deploy re-runs on the merge.

## The Pages mirror — behind the Hosting gate

**Why.** Most staff open the app on the GitHub Pages mirror, and until 10 November 2026 GitHub built it
straight from `main` with no test: on 24 Oct 2026 v24.94 failed the Hosting gate while the mirror shipped
it, and most staff ran a refused release for about three hours. Since 10 November 2026 the mirror is
published by `deploy-mirror.yml`, only after a passing Hosting run. Still open: `main` requires no checks
before a merge (`ARCHITECTURE.md` → EXC-008; step 1 below).

**How it works.** `deploy-mirror.yml` publishes only the commit a SUCCESSFUL "Deploy Firebase Hosting"
run released — a push to this repository's `main` or a run started here by hand (a fork's look-alike run
is refused), with the commit on `main`. It checks every precached file is in the site, deploys, proves
the live mirror serves that version, and reports a failure on the shared `deploy-failure` issue. It reads
the Pages setting first and stands down if Pages builds from the branch again (Undoing it, below). The
hourly currency check knows the gated mirror trails Hosting.

**The owner's settings — none can be made from the repository.** Steps 2 and 3 were made on 10 November
2026; step 1 is still open.

1. **Require the checks on `main` — still open.** GitHub → the repo → Settings → Rules → Rulesets → New
   branch ruleset. Target the default branch. Turn on **Require status checks to pass** and **Require
   branches to be up to date before merging**, and add the checks from a recent pull request run:
   `version`, `unit`, `nodeps`, `functions`, `rules`, `csp`, `signed-in` and every `smoke` entry (three per
   screen size: `smoke (chromium, 1/3)` to `3/3`, and the same for `mobile-chrome`). `signed-in` is one
   check for both phone engines. Leave out `guard` (it decides whether the others run) and `visual` /
   `visual-webkit` (report-only by design). Whether the `webkit` entries gate merging is your call: the
   deploy runs a few Safari tests, not that lane (DECISIONS.md → "A few Safari tests gate the release").
2. **Require approval for outside contributors — made 10 Nov 2026.** Settings → Actions → General →
   "Approval for running fork pull request workflows from contributors" → **Require approval for all
   external contributors**.
3. **Switch the Pages source — made 10 Nov 2026.** Settings → Pages → Build and deployment → Source:
   **GitHub Actions**.

**Publishing by hand.** Actions → "Deploy GitHub Pages mirror" → Run workflow, from `main`. A manual run
or re-run publishes the newest commit Hosting released — never main's tip. **After any change here,
check it:** open `https://garethdavidmiller.github.io/roster-app/` in a private window — past the splash,
no red console errors (CLAUDE.md → "Deployment health check").

**What it means for a release.** The mirror updates after the Hosting deploy finishes. The deploy's gate
jobs are `check`, the six `smoke` shards, `csp`, `signed-in` (Android Chrome) and `safari` (the iPhone's
engine); the slowest is a `smoke` shard, about 7 minutes. When the pull request's own run passed the
first four on the identical tree, they stand aside and the deploy waits for `safari` alone (3m 57s on
the first release to run it, v26.31 on 18 November 2026, whose whole deploy took 6m 29s). `safari` never stands aside. The deploy's
`tested` job says which way it went. The mirror's own publish then takes under a minute. A docs- or
tests-only push republishes neither origin; a failed gate leaves BOTH on the previous release, and the
issue says so.

**Undoing it.** Set the Pages source back to "Deploy from a branch" (`main`, `/ (root)`); the workflow
stands down. The root `.nojekyll` file is what the branch build needs, so it stays either way.

## Adding an Other Staff login

For somebody who needs the roster but has none of their own and no manager rights (owner, 23 Nov 2026).
They sign in under their own name and see everyone's roster read-only, Trains, and the Huddle, Circular
and Newsletter, plus their own Settings (password, notifications). No Admin, Pay Calculator, Overtime,
Links or New link: the drawer hides those pills, and Admin and the Pay Calculator each show a card saying
why if reached another way (owner, 24 Nov 2026).

1. **One row** in `teamMembers` (`roster-member-data.js`), in the shape at the foot of the array:
   `{ name: 'A. Surname', currentWeek: 1, rosterType: 'main', role: 'Other Staff', hidden: true, otherStaff: true }`.
   `currentWeek` and `rosterType` are placeholders — the row is never drawn. Never put the name on a
   `CONFIG` role list: `validateTeamMembers` refuses it, because a role list carries that role's claim.
2. **`npm run generate:roster-members`** in the same commit, bump, push, merge.
3. **Once Deploy Firebase Functions has finished,** Operations → Staff Login Accounts → **Set up
   accounts**. A plain member login, password their surname.
4. They sign in from the Calendar, choosing **Other Staff** in the grade list (it appears once the first
   such row exists). Operations → Account status lists them, with an "Other Staff" filter.
5. Tell them with `.claude/skills/new-starter/welcome-email-other-staff.html` (the new-starter skill →
   Step 7).

Leaving: remove the row (Removing a staff member, below — the managers' exception applies).

**What the server sees:** a plain member (`{ name, member }`, no new claim), so the rules need nothing
new — they read the roster and write only what any member writes for themselves. The grade narrows the
PAGES on the client (`auth-policy.js`, `otherStaff`), the UX layer, not the boundary
(AUTH_AND_SESSIONS 6).

## Removing a staff member

Six steps, and **the order matters** — step 2 changes what the roster parser can read, and steps 5 and 6
read only what step 3 has DEPLOYED. **This is the long form and the only home of the reasoning**; the
`/leaver` skill is the executable checklist, numbered as here.

**1. Upload the final roster PDF that still contains them.** `hidden: true` removes them from the
`cea`/`ces`/`dispatcher` name list the parser matches against (`generate-roster-members.mjs` keeps
`!m.hidden && !m.managerOnly`). A PDF covering their last days uploaded after that reports them under
`missingMembers` — the same advisory as a genuine absence — so the week imports, looks complete, and
quietly has nobody on their line.

**2. Set `hidden: true`** on their `teamMembers` entry in `roster-member-data.js`. There is no end-date
field, so until this lands their base roster keeps producing shifts in the Calendar and Team Week View.
Do it promptly once step 1 is done.

- **An Other Staff login (`otherStaff`): remove the ROW** — it is hidden already and holds no role list.
- **A manager or clerk (`managerOnly`): remove the ROW**, and take them out of `CONFIG.MANAGER_NAMES` in
  the same commit (2b). Management rows are hidden already, so hiding changes nothing and step 5 would
  never disable them. A row moved off a line keeps that line, which `roster-data.test.mjs` reads ("A
  member changes grade", below).

**2b. If they held a role, take them out of it.** `CONFIG.ADMIN_NAMES`, `CONFIG.MANAGER_NAMES` and
`CONFIG.LINKS_DESIGNERS` are **not filtered by `hidden`**: `resolveRosterAuthConfig` unions every
role-holder into `processMembers` (so a sweep can never disable the admin), so a role-holder left on a
list is immune to step 5 **and invisible to step 6's audit**, which compares against that same active
set. Check the three lists by hand.

**3. Regenerate in the same commit, ship it, and wait for the Functions deploy.**
`npm run generate:roster-members` with step 2 (`sw-asset-check.test.mjs` fails if they drift); bump and
push. **Wait for Deploy Firebase Functions to finish green before step 5**: Set up accounts and the audit
read `functions/roster-members.json` as last DEPLOYED. Pressed early, both still see the leaver — "No
leaver accounts to disable", "Everyone on the roster has a login, and no leaver still has one" — and the
login goes on working. The leaver gone from the pages proves nothing: Hosting and Functions deploy in
parallel, in no fixed order.

**4. Overtime: every already-open week.** A week's population is frozen when it opens, so a leaver stays
outstanding in every open week. Use **Stop asking** on their row in *Who is being asked*, once per open
week ("Somebody who has left, and is being chased every week", below); a closed week refuses it by design.
Nothing to do while Overtime is paused.

**5. Operations → Staff Login Accounts: tick "Disable accounts for anyone no longer on the roster
(leavers)", press Set up accounts, read the dry-run preview, then press Confirm.** Nothing is disabled
until Confirm. Until this runs the account works, on the surname default too (`ARCHITECTURE.md` →
EXC-005). **It also stops their notifications:** the confirmed sweep deletes the push records the
disabled account owns (`releasePushForOwner`, `functions/push.js`), which otherwise go on receiving every
staff broadcast. (The pay reminder is targeted from the roster and never reached a leaver.) A record
older than owner-stamping cannot be attributed and goes when the push service retires it.

**6. Check it actually took.** The Staff Login Accounts card runs a read-only audit
(`getAccountSetupGaps`) of the server-owned roster against Firebase Auth. Done properly it reads
*"Everyone on the roster has a login, and no leaver still has one."* A leaver still enabled is named ("1
leaver can still sign in"), and **Needs attention** at the top of the page carries *Leavers still active*
until it is fixed. This step exists because **every failure before it is silent**. It checks logins only,
so 2b's lists and step 4's weeks are checked where those steps say. **"Couldn't check"** (the connection,
an account list the server could not see, an unreadable answer) is not a pass — retry it.

**What the Set up accounts result lines mean:**

- **"Reset to the default password and signed out"** — an account at a roster email with no custom claim
  (registered from outside before the server provisioned it), or a DISABLED account it re-enables (such
  as a returning leaver's). It stamps `resetAt` first, resets to the surname default, signs out every
  session, removes a disabled account's push records and enables it, and stamps the claims last. Tell
  the member their password is their surname. The card names who a run will reset before you press it
  (the audit's *no permissions* and *account disabled* reasons).
- **"Access reduced and signed out of every device"** — anyone a run took admin, manager or Links
  designer from (`demoted`); their sessions are revoked at once, their password untouched.
- **Failures:** `reclaim-failed` or `re-enable-failed` (the latter stays disabled), `lookup-failed` or
  `stamp-failed` — nothing was done or no claims stamped for that name. Run Set up accounts again.
- A confirmed leaver run also switches off notifications that leavers disabled on an earlier run had
  saved again, and counts them.

### What this does NOT do

**Their data stays, deliberately.** Overrides are keyed by name, so past shifts, leave and absences
remain an accurate record. Their `staffContact` work email also stays; removing it is a separate
decision.

## A member changes grade

A promotion, or a move into management, changes two things the app treats differently — which decides
when the change can be released.

**Their line has a date; their grade, for most purposes, does not.** A move to another line is a
`rosterChanges` entry with a `from` date (`.claude/rules/roster-data.md` → rosterChanges), so the days
before keep the old line whenever the release lands. Their grade is `role`, the grade NOW, and from the
release these treat them as the new grade on every date, past ones included: the roster import's name
lists (`npm run generate:roster-members`); where they are listed (the Calendar's member list, Team Week's
grade tabs, the sign-in grade step); and the New link page.

**Record the old grade with its last day**, as `roleHistory: [{ role: 'CEA', until: new Date(2026, 10, 21) }]`
— the day BEFORE the change, midnight local, inclusive — and set `role` to the new grade. `roleOn(member,
date)` (`roster-roles.js`) reads the two together. **The leave allowance** follows it (owner, 16 Nov 2026,
"role at the time": the grade held on 31 December, or where that has no leave figure — Management — the
latest graded post that year; `allowanceRole`, `al-contract.js`; a `proRatedAL` figure wins). **The Pay
Calculator** prices each payslip at the grade held on its days (`.claude/rules/paycalc.md` invariant 17)
and tells the member once — **nothing needs doing in it**. **Never delete a `roleHistory` entry**: without
it the member reads as the new grade on every date worked, and every payslip is re-priced.

**One date the tests refuse:** a change of grade inside a pay award's backdated months (April to the
payslip the award is paid on). `paycalc-grade-wiring.test.mjs` fails whichever commit brings the two
together; decide how that lump splits, with the payslip in hand, before dating it.

**So release it between two uploads**: after the last week under the old grade is uploaded and before
the first week under the new one. Upload a week out of that order and their row is skipped on one roster
and reported missing on the other — and a missing member reads exactly like an absence (step 1 of
"Removing a staff member", above).

**Into management.** Give the row `role: 'Management'`, `hidden: true` and `managerOnly: true`, move it
into the Management block, add the name to `CONFIG.MANAGER_NAMES`, and run
`npm run generate:roster-members` in the same commit. Keep the row's `rosterType` and `currentWeek`: it is
never drawn, and its line is what a test compares the successor's against. Then:

1. **From the release** their own shifts and leave are no longer shown (the records stay, as a leaver's
   do). Staff Login Accounts lists them with *wrong permissions* until step 2.
2. **Their manager access starts when Set up accounts is next pressed** — any press, for any reason — so
   leave the button alone until the day access should start. They then sign out and back in.

Their login keeps working throughout: a manager stays in the server's active list
(`getMembersForGrade('Management')`), so the leaver sweep never touches them.

**The worked example: 22 November 2026.** Three members moved that day — one CEA became a CES on a line a
colleague left, that colleague became a manager, and a third member moved from the bilingual link to the
main line the first had left. The week of 15 November had been uploaded, the week of 22 November was due
on 19 November, and manager access was to start on 22 November. The rows are in `roster-member-data.js`,
and the "22 Nov 2026" tests in `roster-data.test.mjs` check each move day by day.

## Changing a member's roster name

There is no rename procedure. A member's Pay Calculator figures are stored on each device under their
name, so after the change they stay under the old one, and a backup made under the old name is refused
(the app tells them to contact the admin). **Ask them to note their figures before the change.** Carrying
them across would need a former-name record, which does not exist (KNOWN_LIMITATIONS.md → "A backup made
under a member's old name does not restore under the new one").

---

## Which year's allowance a January leave day comes out of

Some staff may take a few of one year's days in early January of the next (owner, 3 Nov 2026). By
default a January day counts against its own year; the **"Which year's allowance"** panel on Admin's
Annual Leave card lets it count against the year before. A member moves their own days, a manager or the
admin anyone's, and a day can never move to a year with no days left. Design: `leave-year.js`; field:
`leaveYear` (docs/DATA_MODEL.md).

- **Every January, from January 2026** (owner, 15 Nov 2026). The panel lists this year's January and
  next year's, so a January stays on it until the end of its own year.
- **The cap reads the app's own figures for the earlier year.** For January 2026 it is only as good as
  the 2025 leave recorded in the app: where 2025 was not all recorded the panel shows days left that were
  taken. **Check the panel's 2025 figure against the depot workbook before moving a day.**
- **It is ON** — `LEAVE_YEAR_CHOICE` in `leave-year.js`, with the assertion in `leave-year.test.mjs`. It
  was switched on only after **Deploy Firestore and Storage Rules** had finished, because the rules that
  accept `leaveYear` and the app that writes it deploy in parallel (CLAUDE.md → Workflows). Switching it
  off hides the panel; moved days keep counting against the year they were moved to.
- **Check it:** Admin → Record Annual Leave for somebody with leave booked in January — the panel appears
  beneath the Record button.
- **What the app cannot enforce:** "no more than the previous year has left" is a count across records,
  which rules cannot take; a request sent around the app is not checked — the same footing as the
  booking's over-allowance warning.
- **Against the depot workbook:** the app counts moved days in the earlier year, the workbook carries them
  forward as c/f. Next year's remaining agrees; last year's differs by exactly the moved days
  (AL_WORKBOOK.md §9).

## Checking the clerks' leave sheet against the app

Operations → **Annual leave sheet** (admin only) shows where the clerks' annual-leave workbook and the app
disagree, person by person, and why. For the people you confirm it **adds the leave the app is missing**,
and counts leave the app already holds on a rest day you answer *Swapped — counts* (Step 3). **That is all
it ever writes**: any other difference is changed in Admin, with Change a Shift. Plan of record:
`docs/AL_UPLOADER_PLAN.md`.

**Step 1, in a Claude session.** Upload the workbook and ask for a **leave file**. The session runs
`scripts/make-leave-file.mjs`, which reads the workbook by the `AL_WORKBOOK.md` method:

- It **asks** about anything it cannot settle mechanically — a name that does not match, a duplicate row,
  a January date, an unreadable comment date (`24 Dec`, `Christmas Eve`, a half day), dates beside a blank
  count with words (`NOT TAKEN`) — and writes nothing until answered. Names match only within their own
  grade block, and a one-word Sunday tag never by itself.
- It refuses a workbook not shaped as the method knows, and a row whose Used is blank while it still holds
  a name or a column-E figure or comment.
- Name answers travel inside the file, so the next copy does not ask again — unless the roster now says
  otherwise. Every other answer is asked again on every copy, because rows move.

**The file names colleagues against their leave**, so it is kept outside the repository and never
committed: the script will not write inside a checkout, `.gitignore` covers the names a phone gives a
download, the commit hook refuses one by any name (where installed), and `leave-file-privacy.test.mjs`
fails in CI if one is tracked — the alarm, not the lock. It is **sealed**: the card refuses a hand-edited
file. A correction goes back through the session.

**Step 2, on Operations.** Open the card and choose the file, or paste its text. The card reads every
comparable member's records and shows:

- **A summary:** how many need a look, how many agree, and who was not compared and why.
- **One fold per person:** chips name each kind of difference, and each day says what the SHEET has, then
  what the APP SHOWS (what the Calendar draws, not a stored record no screen shows). **A person is under
  "Agree" only when the two figures agree.**
- **Leave only the app has.**

The card names each difference as a fact about the two records, never one side being wrong — the workbook
is a quota grid and the app a leave record, and both can be right (AL_WORKBOOK.md §9).

| Chip | What it means | What to check |
|---|---|---|
| not in the app | the sheet has leave on a day the pattern has them working, and the app has nothing | whether the leave was booked |
| rest day to ask about | the sheet has leave on a rest day, and the app has nothing | whether it was a swapped working day, which only whoever booked it knows. Admin's booking asks the same question (`.claude/rules/admin.md`) |
| costs nothing in the app | the app holds the leave on a rest day, so it costs nothing | where the day carries "Was it a swapped working day?", the same question from the other side. Without it, the record already says the day was a rest day (leave over RDW, a correction, an Other day or a Spare turn), and Admin never asks |
| from another year's allowance | the app charges it to a different year's allowance | see "Which year's allowance", above |
| differs | the app shows a shift, an absence or a rest day there instead | which of the two is right |
| with work recorded | the app shows RDW, an Other day or a Spare turn there | with care: recorded work is pay evidence |
| before their start date | the sheet has leave before the member's start date in the app, where the app shows and counts nothing | whether the start date in the app is right |
| only in the app | the app holds leave on a date the sheet does not have; the row says which year's allowance it costs | with the clerks |
| after the sheet ends | the app takes leave from this year's allowance on a date after the sheet's last one — a January day moved back | nothing, usually: the sheet will carry the day forward instead (AL_WORKBOOK.md §9) |
| undated over quota | the sheet deducts days over quota with no date, so they cannot be matched to a day | the dates, with the clerks, if the app is to hold them |
| allowance differs | the sheet's allowance and the app's disagree; the row gives each side's parts (the sheet's carried-forward and joiner figures, the app's own note) | `proRatedAL` and the joiner rows (AL_WORKBOOK.md §5 and §9); from the 2027 sheet, also a day in lieu for the Boxing Day before, which the app adds and its note names (AL_WORKBOOK.md §10, question 13) |
| figures differ | the two figures differ and nothing on the sheet says why — a safety net that should never show | report it: it means the card has met a case it does not know |

Never counted as a difference, and listed in a fold of their own: a day that agrees, a Sunday the clerks
have tagged, a **carried** day (the carry-over working as designed — the sheet adds carried days and
counts January in this year, the app takes them from last year's allowance, and both reach the same
figure), and leave on a Spare day past that week's first four (a Spare week costs at most 4 days in the
app; the summary names those days for the clerks). A corrected sheet figure is explained on the row.

**Age.** The card says when the clerks last saved the sheet. Past **14 days** — or with no save date —
the comparison still shows but the file **cannot be saved**: ask for a fresh copy (AL_UPLOADER_PLAN.md
§10, decision 4).

**Offline, it stops** — a read from this device's copy could call leave missing that is not.

**The answer on screen is always for the file on screen.** Choosing another file, or typing in the paste
box, clears it; choosing the same file again re-reads it. **Your answers survive**: Check again, a new
copy and the paste box bring back every answer the new check still asks about. Only Clear forgets them,
and it asks first. An app update waits while a check runs, its answer is on screen, or answers are
unsaved — **Clear the check** when done to let it in. A notification tap waits only for an unsaved
confirmation or *Swapped — counts*, or a running Save or Undo.

**Who is left out, and why:** leavers, managers (except for a year in which they held a graded post),
anybody with no allowance on record, and anybody the app does not hold — each named in the summary with
the reason **as the roster stands today**. A member in the app and not on the sheet is listed too. Not
counted as "only in the app": leave on a Sunday, before a start date, or on 25/26 December, and next
January's days taken from next year's allowance.

**Step 3, the Save.** Under each person who needs a look:

- **A rest day is asked about in Admin's words**: "Was it a swapped working day?" — *Swapped — counts* or
  *Rest day — free*. Nothing is pre-chosen; an unanswered rest day is not saved.
- **Confirm the person.** The box says what it does ("Add 2 days of leave for …", or "…, and count 1
  booked rest day as swapped for …"), beside that person's figures **after** the Save and whatever would
  still differ. There is no "accept all".
- **Press Save.** Each day is written as Admin's leave card writes it and checked as it is written: a day
  changed since the check — including one you booked by hand in Admin — is **refused, by name**, nothing
  of that person is written, and your answers stay. **Offline, nothing is written** and the review stays.
  If the page could not load what it saves with, the receipt says the Save **never started**: reload,
  check again and save.
- **The receipt** is read back from the server, so a Save whose answer was lost is still reported and
  recorded. It names every *Rest day — free* answer (nothing written; existing leave left as it is). The
  card then re-checks the file. If it says the Save **stopped part way**, check and save again: only the
  rest is sent.

**What it will not do.** Write a day that differs any other way, a Sunday, or 25/26 December; put back a
day **removed in the app since** this sheet was last saved here (shown, with "add it in Admin"); or save
at all when the file is over 14 days old or undated, when a **newer copy has already been saved**, when the
record of earlier Saves cannot be read, or when you are not signed in as yourself.

**The log and the Undo.** Each Save is recorded (`alUploads`, admin only — DATA_MODEL.md): which copy, who,
and which days it added; a Save that landed nothing records nothing. If the record cannot be written or
read back, the receipt says so and the **next check of the same file** records it. The latest Save of the
year that added leave has an **Undo**, which takes back only its days nobody has changed since (each
record carries the Save's mark, removed by any later save of that day), keeping and naming the rest. A
counted swap is never taken back. It works once; an Undo that **stops part way** is finished by pressing
it again, and one that could not read the records took nothing back and stays on screen. Saves made with
v26.13 or v26.14 carry no marks, so they show **no Undo** — take their days back in Admin. Records are
kept for this year's sheet and last year's; an earlier year's sheet is a check only.

**Unsaved answers ask before they go.** Clear, a drawer link, the header logo, signing out and closing
the tab each ask while a confirmation or *Swapped — counts* answer is unsaved; signing out also asks
while any change is still on its way to the server. The answers are never stored: they name colleagues
against their leave.

## The staff PIN (retired)

**Retired 23 Nov 2026 (owner).** The shared four-digit staff PIN no longer opens anything: the Calendar
and Trains open only to somebody signed in under their own name. Why, and the three releases that remove
it: DECISIONS.md → "The staff PIN retired".

**A phone still holding a PIN session** is signed out the next time it opens the Calendar or Trains, and
its sign-in card says the PIN has been retired and to sign in with their own name (asking the admin if
they have no login). Nothing needs doing on the phone.

**Somebody who used the PIN and has no login:**

- **On the roster** — they already have an account (password their surname until they set their own).
  If they have never signed in, check Operations → Staff Login Accounts; a new starter follows
  `/new-starter`.
- **Not on the roster, but needs to read it** (another team, a manager with no shifts) — an Other Staff
  login: "Adding an Other Staff login", above.
- **Forgotten password** — "Can't get in?" on the sign-in card ("Locked-out member → reset request
  queue", above).

### The server release — what it removed

The rules accept the `calendarViewer` claim nowhere (a token still carrying it is refused everywhere,
like an anonymous one, and `viewerAttempts` has no rule, so every client is refused it); the
`unlockCalendarViewer` function, its throttle and lockout notice, the `CALENDAR_VIEWER_PIN` binding, the
viewer door in `getDocumentUrl` and the Operations PIN-lockout card are deleted. The Functions workflow's
`firebase deploy --only functions --force` deletes a function `index.js` no longer exports, so nothing is
deleted by hand; `firebase functions:list --project myb-roster` confirms `unlockCalendarViewer` is gone.

**Kept on purpose until the cleanup release:** `functions/retired-viewer-account.js`, so Set up accounts,
the leaver sweep, a reset and the notices never adopt the shared account while it exists, and the client's
teardown of a leftover PIN session.

### After the server release — the manual steps

The owner's, once **Deploy Firebase Functions** and **Deploy Firestore/Storage rules** have both finished
for the server release, in this order:

1. **Delete the `calendar-viewer` account** — Firebase console → Authentication → Users → the account
   with uid `calendar-viewer` → Delete. Any session still open on it ends at its next token refresh.
2. **Destroy the secret** — `firebase functions:secrets:destroy CALENDAR_VIEWER_PIN --project myb-roster`.
   That destroys the latest version; `firebase functions:secrets:get CALENDAR_VIEWER_PIN --project myb-roster`
   lists any left, or delete the whole secret in Google Cloud → Secret Manager.
3. **Purge `viewerAttempts`** — Firebase console → Firestore → `viewerAttempts` → Delete collection (or
   `firebase firestore:delete viewerAttempts --recursive --project myb-roster`). Nothing reads it any more.
4. **Consider turning off Anonymous sign-in** — Authentication → Sign-in method → Anonymous. Nothing signs
   in anonymously and the rules refuse it, so this only removes it at source; check in a private window
   afterwards that the Calendar still loads (KNOWN_LIMITATIONS.md → "The member claim").
5. **Keep** `roles/iam.serviceAccountTokenCreator` on the runtime service account: `getDocumentUrl` needs
   it (RECOVERY_RUNBOOK.md project facts).

Then the **cleanup release** removes the client's transition code and
`functions/retired-viewer-account.js` — after step 1, because until the account is gone a session on it
can still exist.

**Never write the PIN's value anywhere** — not in a doc, a commit, a ticket or a test.

---

## Overtime Availability — PAUSED

**PAUSED (owner, Nov 2026)** — closed to everyone, the admin included, and nothing runs but the retention
purge. `CONFIG.OVERTIME_ENABLED` in `roster-data.js` is the switch; `OVERTIME_AVAILABILITY.md` → Paused
has what it does and the way back. The rest of this section is the operating guide for its return.

Staff declare, per day, when they are available for overtime in a future roster week; a Manager or the
Master Admin reads the answers by day and plans cover. Full design: `OVERTIME_AVAILABILITY.md`.

### The weekly rhythm

Windows are named by their **week-ending Saturday**. Counting back (`MILESTONE_OFFSETS` in
`functions/overtime-core.js` is the authority):

| When | What happens |
|---|---|
| Sat −18d, 12:00 | **Initial deadline.** Everyone should have answered. |
| Sat −16d | Draft roster published. |
| Sat −11d, 12:00 | **Final deadline.** Forms close; answers are final. |
| Sat −9d | Final roster published. |
| Sat +91d | The window expires and stops appearing anywhere. |

### Weeks open by themselves — there is nothing to remember

**A scheduled job creates every missing horizon week at 05:00 London, daily** (daily, so a missed run
heals within a day). *Upcoming weeks* is the **monitor over that job**: computed from the calendar, it
shows every horizon week whether or not a form exists, and its collapsed chip counts the weeks
**without** one — glance at that.

| Row says | Meaning |
|---|---|
| **Form open** | Staff can answer. The page opens on the earliest of these — the week being planned. |
| **Form closed** | Created, and past its final deadline. Still readable; that is the record the roster was planned from. |
| **Opens automatically overnight** | No form yet, and none needed by hand — tonight's run will make it. |
| **Did not open overnight · create it here** | The last nightly run was due to open this week and did not. Press **Open now** on the row; that fixes the week whether or not the run itself is ever diagnosed. Investigate only if it repeats — the Functions log for `autoCreateOvertimeWindows` says what happened. |
| **No form yet · first deadline has passed** | Still opens automatically, but late enough to be worth a look: anyone answering now misses the draft roster. |
| **Missed · no form was opened, so nobody was asked** | The final deadline went by with no window. It cannot be recovered, and the row stays until its Saturday passes. |

### Nobody is asked silently any more

Two push notices go out by themselves, **only to the people they concern**:

| Notice | Who gets it | When |
|---|---|---|
| ⏱️ *Overtime — availability form open* | each member a window has just started asking | the run that adds them, naming their soonest deadline **still ahead** — a week opened late names the final deadline, never one already passed |
| ⏱️ *Overtime — answers due today* | participants who have submitted **nothing** | the morning of the initial deadline |

One notice per member per run, however many weeks; nobody who has answered is reminded, and a withdrawn
participant is not asked. So a remaining "No response" from somebody with a subscribed device is likely a
real answer — worth a call rather than a nudge. **It can fail quietly, by design:** a member with no
account or no notifications is skipped, so a missing notice is not evidence — the page is the record.
The Functions log lines are `[overtimeAsked …]` and `[overtimeReminder …]`, each stating how many targets
it resolved.

### Opening a week early, by hand

Rarely needed. Overtime → **Upcoming weeks** → **Open now** on the row (deliberately secondary). A confirm
bar previews the week, the initial deadline, the audience and the expected participant count, produced
by the same server code that commits; press **Open the form**. A row with no button is past its final
deadline — that week is missed.

### During and after the window

**Who is available** opens on the week being planned; *View* switches to any other, including **Previous
weeks** (every week within the 13-week retention).

- **Three sections that never merge:** Available, Not available, and **No response** — not a soft "no",
  and the list a phone call works from, with *Awaiting a form*. A strip of seven chips counts who offered
  **some** availability each day; only **zero** is marked (red), because the app does not know which
  shift you are short of. Tap a chip for that day, *All week* to return.
- **Each row states the person's current roster** (the Calendar's shift chip for that date). Where an
  answer was anchored to a shift that has since moved, **Roster changed since this answer**.
- **Submitted after initial deadline** — nothing arrived until planning had started. **Changed after
  initial deadline · was …** — shown only on the days that moved.
- **Viewing by grade:** one chip per grade in the week (none when there is only one). Picking one
  recomputes everything — a CEA gap is not filled by an available CES. The grade choice follows you
  between weeks; the day filter does not.

### "Asked to come off this Sunday"

A member ROSTERED to work a Sunday can tick **Ask to be taken off this Sunday**, and their row carries the
request — the place for "I am away for my Sunday duty", since leave and absence cannot be recorded on an
uncontracted Sunday.

- **It is a REQUEST and the app grants nothing** — no override, no roster change, no leave. You decide
  outside the app, which records nothing of your decision, so the Calendar shows the Sunday duty until the
  week's PDF is imported or the shift is changed in Admin.
- **It is NOT an answer about overtime.** A member can ask and still have that day in **No response**. Do
  not read a request as either answer.
- **It only appears on a Sunday** (the server refuses it on any other day), so one under a Monday means a
  client that should not exist.

### Somebody who has left, and is being chased every week

A week's population is frozen when it opens, so **a leaver stays outstanding in every open week**.
**Stop asking** on their row in **Who is being asked** removes them from that week's counts, day panels and
title chip, and adds a **Not being asked** footnote naming them, who stopped asking and when; their form
and answers are kept. **Ask again** on the footnote reverses it (until the first deadline for somebody
stopped before it; while the week is open otherwise). The member's own page stops showing the week. Do it
on each open week; a **closed** week refuses it by design — it is the record the roster was planned from.
Withdrawing does not replace `hidden: true` (Removing a staff member), which keeps them out of later weeks.

**On the member's side**, the page opens on the soonest form **not yet answered**; the form names both
deadlines, and a submitted one says "Submitted · updated …". After the final deadline it goes read-only.
Confirm directly with the person before arranging short-notice cover.

### Printing it

**Only *Who is available* prints**, from the **Everyone** tab, as a call sheet: the week, when it was read,
forms in, every day's three sections, *Awaiting a form*, and the *Not being asked* footnote. It prints the
whole week whatever day chip is selected; a **grade** filter IS carried onto paper, and the sheet states
its scope under the title — check that line. The **as at** line says how old the sheet is: anything
printed before the final deadline is a snapshot. Printing *My availability* gives a short notice instead.

### Who can see it

- **Reviewers** (Manager or Master Admin claim): the nav pill, the planning horizon and the by-day
  workspace. A reviewer who is not a participant has no form.
- **Participants:** their own form only. During the restricted beta the audience is server-owned
  (`CONFIG.OVERTIME_BETA`, regenerated into the server copy); widening it is a code change and a deploy.
- **A new invitee** is added overnight to every week whose **first deadline is still ahead** — so expect
  their first form a week or two out, not the current one.
- **Everyone else** sees a short "not open to everyone yet" panel and no pill.

### Diagnosing a problem

- **"Couldn't load overtime availability"** → the Overtime Functions or rules have not finished deploying
  (the three workflows run in parallel); it recovers by itself once they land.
- **A whole week never opened** → the `autoCreateOvertimeWindows` logs say what it did and did NOT create,
  and it stands down rather than proceed if it cannot list existing weeks. **Open now** fixes it while the
  final deadline is ahead.
- **"The form offers the wrong time"** → their shift changed after they answered; the stored answer keeps
  its time and the day carries a note. Nothing to do unless they want to change it.
- **`no-participants` (409) on Create** → the audience selected nobody; it fails closed, because a window
  reading "0 of 0 received" looks complete.
- **A new starter never gets a form** → regenerate (`npm run generate:roster-members`) and redeploy
  Functions; open weeks gain them overnight while their first deadline is ahead.
- **"My submission vanished"** → it did not: submissions are append-only. Check the week's *Who is
  available* first.

---

## The Trains page's timetables

`trains.html` compares two Chiltern timetables held in one generated file, `trains-data.js`. Nothing about
it is live: its times change only when somebody regenerates that file. Every signed-in member can open
it, an Other Staff login included.

- **What it holds:** today's books, valid until Saturday 12 December 2026, and December's, valid 13
  December 2026 to Saturday 15 May 2027 — Chiltern's public timetables, every stop included. The generator
  still accepts the roster office's simplifier as a fallback for a side whose books are not out (no stops).
- **When to regenerate:** whenever Chiltern issues new books — a correction, or the May 2027 timetable
  (deadline in `MAINTENANCE_CALENDAR.md`). The steps and the figures the tests hold to the printed books:
  `docs/timetable-dec26/tooling/README.md`. If a hand-checked figure moves, check the books before
  changing the test — a new issue and a parser fault look the same. The Staff Guide's Trains section
  (`#sg-trains`) names the December 2026 change in words, so May 2027 needs it reworded by hand.
- **Christmas and New Year are not in the books.** Chiltern says times will still change between
  13 December and 10 January, so the overview says so until `FURTHER_CHANGES_UNTIL` (10 January 2027),
  above its fold, then drops the note by itself.
- **Never commit the inputs.** The PDFs and simplifier spreadsheets stay out (the tooling's `.gitignore`
  refuses them); the spreadsheets hold platforms, lengths and diagrams that are not passenger facts.
- **It turns over by itself on 13 December**: the first column reads "Until 12 Dec", a typed time is
  looked up in the running timetable, and a new end reads "Now goes on to …"; after `DEC_VALID_UNTIL`
  (15 May 2027) the page says both have ended. Check it live that morning (MAINTENANCE_CALENDAR).
- **A weekday's figures are a Tuesday to Thursday's — and where the days disagree, the page says so.** A
  few weekday trains run only Monday and Friday, or only Tuesday to Thursday; the totals then give each
  its own row, and a station's card names the days its answer is for (`weekdayGroups`,
  `trains-weekdays.js`). The headlines and Last trains read the same every weekday, so they name no days;
  `trains-stations.test.mjs` fails if a new timetable changes that.
- **A station's answer is followed by the rest of what changed** — fastest journey (2 minutes or more),
  first and last train (10 minutes or more), and the day's count when the answer was the daytime hour —
  the facts in its favour first, so a gain is never read without its cost (`balanceFacts`,
  `trains-verdict.js`).
- **Coming back is timed at the station** the passenger boards at, with the Marylebone time as small
  print.
- **Leaf fall.** Until 10 January Chiltern runs London-bound Amersham-line trains up to 3 minutes early;
  today's book carries that and December's does not, so those cards say so. `LEAF_FALL` in `build.py` —
  read it off Chiltern's timetable page each autumn.
- **What the books print that a list of stops cannot** (pick-up-only and set-down-only stops, early
  arrivals, buses, weekday variants): the tooling README → "What each step knows".

### The one-off New link push, before the vote

**Thursday 26 November 2026, 18:00 London** — `sendNewlinkVoteReminderNotification`
(`functions/newlink-reminder.js`, wired in `index.js`) sends ONE targeted push, "🔁 New link — vote coming
soon", to the people the New link page lets in (`newlinkAudience` in `roster-members.json`, from
`canOpenNewlink`), landing on the New link page (owner, 26 Nov 2026). A daily 18:00 schedule with a
one-date guard.

- **Did it go?** Its log says "New link reminder — N of M member(s) resolved, N subscription(s)
  accepted"; it reached somebody only when the last N is above 0.
- **It sends once even if the schedule runs twice:** it claims `oneOffPushes/newlink-vote-2026` first and
  records the outcome there (`sent`, `reached no device`, `failed`; `claimed` alone means the run died
  mid-send). A second run logs "Already claimed". To send again on purpose, delete that document and fire
  the function by hand.
- **Afterwards** it is harmless; in a later release remove the function, its line in `index.js` and in
  `functions-surface.test.mjs`, `newlinkAudience` if nothing else reads it, and the `oneOffPushes`
  document.

### The one-off timetable push, and the Calendar's timetable notice

Two reminders run themselves before the change:

- **Saturday 12 December 2026, 18:00 London** — `sendTimetableReminder` (`functions/documents.js`) sends
  ONE broadcast push to every subscribed device, "🚆 Timetable — new times from Sunday", landing on Trains.
  A DAILY schedule with a one-date guard: other evenings log "Not the evening before the change —
  skipping". **Did it go?** The log says "Timetable reminder — N subscription(s) accepted" (or warns "no
  subscription accepted it"). **To stop it beforehand:** GCP console → Cloud Scheduler → the job named
  after the function → Pause — and pause again after any Functions deploy before the 12th, which
  re-creates it enabled. Permanently: delete it from the builder's return in `documents.js` and from
  `functions-surface.test.mjs`, and deploy. The next change moves `TIMETABLE_CHANGE` there (the test holds
  the headline's "from Sunday" to a Sunday).
- **16 November to 12 December** — the Calendar notice `timetable-soon-2026` (`calendar-notices.js`),
  once per signed-in member, retiring itself on the 13th. Until 6 December it comes after the install
  notice (a phone or tablet in a browser) and the New link notice; from Sunday 6 December it goes first
  (owner, 16 Nov 2026 — DECISIONS.md). Seeing the push and the notice is intended: the push reaches phones
  with notifications on, the notice everyone who opens the Calendar.

## The new link page

`newlink.html` shows colleagues the three shortlisted proposals for the new CEA link — **which starts in
January 2027, not with the timetable** (owner, 2 Nov 2026; the day not yet set, owner, 8 Nov 2026). **Open**
since v25.60 to everyone on the normal CEA contract and the managers (owner, 9 Nov 2026), and to the names
in `CONFIG.NEWLINK_PREVIEW` (`roster-data.js`).

**Every setting is one line in `newlink-config.js`** — `CHOSEN`, `STARTS`, `TIMETABLE_STARTS`, `CONTACT`,
`CONTACT_ROLE`, `CLOSES`, `AUDIENCE`, `PHASE`, `PACK_BASE` and the "Have your say" lines — each an owner
decision recorded beside its line.

**When a design is chosen, name it in `CHOSEN`** — 'Balanced V6', 'Level Crossing' or 'Middle Ground',
spelt as the page shows it (owner, 10 Nov 2026). `PHASE` follows it to 'decided': the status card says
which design and when the link starts, and the page stops asking for views. A name off the shortlist is
refused by `newlink-config.test.mjs`. **If nothing is chosen by `STARTS`, the page stops asking anyway**
and says only that the contact will confirm the outcome; it never names a design by itself.

**Who is in charge is part of the wording.** The contact leads the change (`CONTACT_ROLE`, owner, 4 Nov
2026); the admin built the page and the tooling and decides neither, so **no line may name the admin as
deciding, recommending or collecting views**, and how the choice is made stays deliberately vague
(`newlink-config.test.mjs`, `e2e/newlink.spec.js`). The process is in LINKS_DEC2026_PLAN.md's dashboard,
not in anything colleagues read.

**Who it is for: everyone on the normal CEA contract, and the managers; a CEA bilingual contract keeps its
own links** (owner, 8 and 9 Nov 2026) — by contract, not line. CES and Dispatchers are not on it. **The
gate is the `newlinkAudience` role in `auth-policy.js`** (a `role: 'CEA'` member with no
`bilingualContract`, not `hidden`, or a name in `CONFIG.MANAGER_NAMES`), read by the `newlink` policy and,
through `canOpenNewlink`, the drawer's pill. It follows the roster: **a new starter on a normal CEA
contract gets the page once on the roster, and a leaver loses it when `hidden` is set.** It lives in
`auth-policy.js` because `newlink-boundary.test.mjs` keeps the page's modules out of every roster page;
`newlink-config.test.mjs` fails unless the role and `audienceNames()` agree. So **setting `AUDIENCE` to the
26 means changing the role in the same commit**, and closing the page means `PHASE = 'preview'` and
`'newlinkAudience'` out of the `newlink` policy together.

**Letting somebody outside the audience in is one line**: their name, spelt as the roster spells it, in
`CONFIG.NEWLINK_PREVIEW` (`roster-data.js`), then bump and release. It is page access only — no claim, no
`npm run generate:roster-members`, no Set up accounts. `newlink-config.test.mjs` refuses a name not active
on the roster.

**Its PDFs come from the GitHub Pages mirror** (`PACK_BASE`), because Firebase Hosting serves nothing
under `docs/`. Retiring the mirror breaks those links — move the files into a served folder first. And a
`docs/`-only push republishes nothing (`docs/**` is in the Hosting deploy's `paths-ignore`), so a changed
PDF reaches the page only with the next app release.

### When the new link starts — bringing it into the roster

**Never edit `weeklyRoster` in place, and never change `MAIN_ROSTER_WEEKS` or
`MAIN_ROSTER_REFERENCE_DATE`.** A pattern has no start date — `getBaseShift` reads one table for every
date — so an in-place edit redraws every day already worked. Simulated on 10 November 2026 with a
shortlisted design, 5,433 of the 6,573 base shifts the main-link members had from 1 January to 9 November
2026 came out different, leave already taken was re-judged, and "Fill from calendar" for 2026 payslips
moved. Nothing errors; `roster-data.test.mjs` ("a pattern in force is never edited in place") fails
instead.

**Bring the link in as its own roster type, and move each colleague onto it with a dated
`rosterChanges` entry**, in one release:

1. **The table.** Add the chosen design's weeks to `roster-cycle-data.js` as a NEW export, copied cell for
   cell from `links-proposals.js`. Add it to `validateRosterPatterns`' default list (`roster-data.js`), or
   nothing checks it; every cell must pass (RD, OFF, SPARE, a real `HH:MM-HH:MM` whose ends differ, or a
   bare Other flavour Monday to Saturday). Classify it in `public-data-classification.test.mjs` (a shift
   pattern, public).
2. **Its length and reference Sunday** in `CONFIG` (`roster-data.js`): a `…_ROSTER_WEEKS` equal to the
   design's number of lines, and a `…_ROSTER_REFERENCE_DATE` at noon on a Sunday — the start Sunday is
   simplest — each classified in `public-data-classification.test.mjs`.
3. **The type, everywhere the five are named today:** `getWeekNumberForDate` (length and reference
   Sunday) and `getRosterForMember` (table, length, week prefix) in `roster-data.js`, and the member check
   in `calendar-member.js` (its "Unknown rosterType" list). **An unknown type falls through to `main`
   silently**, drawing today's link under the new name.
4. **The moves.** For each colleague on the owner's list (by CONTRACT, not line: a normal CEA contract on
   the bilingual link moves too; the `fixed` rows are the owner's call), ADD a `rosterChanges` entry
   `{ from: <start Sunday>, rosterType: '<new type>', currentWeek: <their line> }` after any existing ones.
   With the reference Sunday set to the start Sunday, `currentWeek` is simply their starting line (it is
   REFERENCE-ANCHORED: `.claude/rules/roster-data.md`). Leave each member's base fields and `weeklyRoster`
   untouched: they draw every date before the start.
5. **What reads the main link by name:** the Links workspace seeds from `weeklyRoster` (`links-seed.js`,
   `links-app.js`). Decide whether it should seed from the new table; leave `weeklyRoster` in place either
   way.
6. **Before releasing:** check every member's base shift on every date before the start Sunday is
   unchanged (snapshot and compare), that each mover's first week reads their line, and that the new type
   is in the `ROTATING` set of `roster-data.test.mjs`'s "no two rows hold one rotating line" test; then
   the suite must pass. No `npm run generate:roster-members`: the server copy carries no `rosterChanges`
   and no pattern.

### Keep only the shortlist (Links)

A one-off for the admin, in the Links workspace's ··· menu: **Keep only the shortlist** moves every design
last saved before 2 Nov 2026 to Recently deleted, so the picker offers the three built-in, read-only
proposals. The dialog lists each design and who last saved it before anything moves. To undo one, restore
it from Recently deleted (a restored design carries a new save time, so it is never offered again). The
row disappears once nothing older is left. Why it is a press and not automatic: `links-shortlist.js`.
