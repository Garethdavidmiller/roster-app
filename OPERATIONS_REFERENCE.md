# Operations Reference — MYB Roster App

*Last updated: June 2026 — v12.28 · Updated every 0.10 version*

Operational detail that is rarely needed in day-to-day development sessions. Referenced from `CLAUDE.md`.

---

## Huddle ingest — full detail

### Firebase Storage

Files stored at: `huddles/YYYY-MM-DD.pdf` or `huddles/YYYY-MM-DD.docx`

Storage URL strategy (v9.53+): `ingestHuddle` generates a time-limited v4 signed URL (1 year).
Falls back to a permanent `firebaseStorageDownloadTokens` download URL if the service account
lacks `iam.serviceAccountTokenCreator` role. Either way the URL lands in `storageUrl`.

Signed URL format:
```
https://storage.googleapis.com/myb-roster.appspot.com/huddles%2FYYYY-MM-DD.pdf?X-Goog-...
```

Download token fallback format:
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD.pdf?alt=media&token={uuid}
```

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle).

```
date         string     "YYYY-MM-DD"
storageUrl   string     Signed URL or download-token URL (see above)
fileType     string     "pdf" | "docx"
uploadedAt   timestamp  Firestore server timestamp
uploadedBy   string     "power-automate" | Firebase Auth UID (manual admin upload)
htmlContent  string     (optional) DOCX converted to HTML by mammoth.js at upload time.
                        Present for DOCX files only. Missing for PDFs and large DOCX
                        conversions (> 800 KB). Viewer falls back to storageUrl if absent.
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

```
match /huddles/{docId} {
  allow read:  if true;                          // app.js reads without an Auth session
  allow write: if request.auth.token.admin == true;  // browser writes: admin only (v10.83)
}
```

Read is open because `app.js` (index.html) has no Firebase Auth session — requiring auth
broke notification auto-open on fresh first visits (v10.76). Browser writes (the manual admin
upload path in `huddle.js`) require the admin claim (v10.83); the automated
`ingestHuddle` Cloud Function uses the Admin SDK, which bypasses rules entirely. The matching
Storage rule (`storage.rules`) also requires the admin claim for huddle file writes.

### Huddle notification tap behaviour (v10.71)

When a push notification is tapped, the service worker (`notificationclick` handler) calls `clients.openWindow(targetUrl)` where `targetUrl` is `./index.html#huddle`. The app's `hashchange` listener fires `_triggerAutoOpen(huddle)` in `app.js`.

**Two code paths — do not unify:**

| Condition | Manual tap (📋 button) | Notification tap |
|-----------|----------------------|-----------------|
| `htmlContent` present (DOCX converted server-side) | Renders HTML inline in the viewer overlay | Renders HTML inline in the viewer overlay |
| No `htmlContent` (PDF, or DOCX conversion failed) | `window.open(storageUrl)` directly — the button tap IS a user gesture | In-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`) |

**Why the in-overlay button for notification taps (no `htmlContent`):**

A notification tap provides no transient user activation in the page. This means:
- `window.open('_blank', ...)` → pop-up blocked by the browser (no user gesture)
- `window.location.href = storageUrl` → navigates the standalone PWA's top-level window to a cross-origin URL; Android wraps the app in browser chrome and the standalone window is lost

Tapping the in-overlay "📄 Open Huddle" button IS a real user gesture. `window.open(storageUrl, '_blank', 'noopener')` then opens the file as an Android Custom Tab overlaid on top of the intact standalone PWA. The Android Back gesture dismisses the Custom Tab and returns directly to the clean standalone app.

**Important:** Do not merge the manual-click and notification-tap paths. The popup-blocking and standalone-mode constraints apply only to the notification-triggered code path. DOCX files with `htmlContent` bypass both constraints entirely — they render inline.

---

## Weekly Roster Upload — full detail

### Cloud Function — `parseRosterPDF`

- **Region:** `europe-west2` (London)
- **Auth:** Firebase ID token — browser sends `Authorization: Bearer <idToken>` where idToken comes from `auth.currentUser.getIdToken()`. The function validates via Firebase Admin SDK. `ROSTER_SECRET` is no longer used anywhere — both `parseRosterPDF` and `setupRosterAuth` use Firebase ID token auth with an admin custom claim.
- **CORS:** `cors: true` — all origins allowed (v9.69). Previously restricted to `[firebaseapp.com, web.app]` (v9.53–v9.68), but firebase-functions v6 with `cors: [array]` does not consistently set `Access-Control-Allow-Headers` on OPTIONS preflight responses, causing browsers to block the POST. Because auth is handled entirely by the Firebase ID token + admin claim, open CORS adds no attack surface. `setupRosterAuth` uses the same `cors: true` setting for the same reason.
- **AI model:** `claude-haiku-4-5-20251001`, `max_tokens: 8192`
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

### AI prompt key rules (do not weaken without testing)

- RDW cells: AI returns `"RDW HH:MM-HH:MM"` — **never strip RDW from the return value**
- Blank/absent Sunday cells: return `"RD"` — do not copy Monday's shift
- Duty/diagram codes on a second line (e.g. `"CEA 16"`) — **ignore entirely**, only the first line is the shift value
- `"N/A"`, `"NA"`, `"NS"` all mean RD on any day
- `"AL"`, `"A/L"`, `"A.L."` all mean annual leave — return `"AL"`
- **AL or Absent on a Sunday is invalid** — Sundays are non-contracted for all grades. The review pipeline (`computeCellStates`) normalises a Sunday `"AL"`/`"SICK"` to `"RD"`, so it classifies as MATCH and is never written as a Sunday annual-leave/absence override. A worked Sunday time stays RDW. Mirrors the in-app rule — see CLAUDE.md "Sundays are non-contracted".

### Review pipeline

```
parsedResult (from Cloud Function)
        ↓
computeCellStates(parsedResult, existingOverrides)
  — classifies each day:
    MATCH    = PDF matches base roster, nothing to do
    DIFF     = PDF differs from base roster, needs saving
    CONFLICT = manual override already exists but differs from PDF
    COVERED  = manual override already matches PDF, nothing to do
        ↓
renderReviewTable() — per-person card list
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

## Firebase Auth — full detail (migration complete at v7.94)

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

`nameToEmail(name)` in `firebase-client.js` and `functions/index.js` must stay in sync with `getSurname()` in `session.js`. As of v12.04, `getSurname()` delegates to `normaliseSurname()` which is exported from `firebase-client.js`. The same derivation is also duplicated in `functions/roster-parse-helpers.js` — this is intentional: Cloud Functions are CommonJS and cannot import browser ES modules. If the rule ever changes, update all three locations.

**Password derivation rule:** surname, lowercase, alphabetic characters only, **padded to a minimum of 6 characters** (Firebase Auth's minimum password length). Surnames already ≥6 chars are used as-is. The same derivation is used both on initial account setup and by `ensureFirebaseSession()` when it self-heals a missing account on page load.

The `@myb-roster.local` domain is synthetic — not real email addresses. Firebase Auth accepts them as valid email format.

Migration history (v7.61 → v7.94) is in `ROADMAP.md` → Phase 2.
