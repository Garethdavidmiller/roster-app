# Operations Reference — MYB Roster App

Operational detail that is rarely needed in day-to-day development sessions. Referenced from `CLAUDE.md`.

---

## Huddle ingest — full detail

### Firebase Storage

Files stored at: `huddles/YYYY-MM-DD.pdf` or `huddles/YYYY-MM-DD.docx`

Each file is uploaded with a custom `firebaseStorageDownloadTokens` metadata field so a stable direct download URL is available immediately after upload.

Download URL format:
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD.pdf?alt=media&token={uuid}
```

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle).

```
date        string     "YYYY-MM-DD"
storageUrl  string     Full Firebase Storage download URL (with token)
fileType    string     "pdf" | "docx"
uploadedAt  timestamp  Firestore server timestamp
uploadedBy  string     "power-automate" (hardcoded — identifies automated uploads)
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
└── Condition: is it after noon? (to avoid duplicate early-morning emails)
    │
    ├── YES branch (afternoon/main email):
    │   ├── Filter array: filter_array_1
    │   │   From: triggerOutputs()?['body/attachments']
    │   │   Condition: item()?['contentType']  is equal to  application/pdf
    │   │             (LEFT = expression tab; RIGHT = value tab)
    │   │
    │   ├── Compose: attachment
    │   │   body('filter_array_1')[0]?['contentBytes']
    │   │
    │   └── HTTP action (Premium)
    │       Method: POST
    │       URI: https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle
    │         (URI goes in value tab, NOT expression tab)
    │       Headers:
    │         Authorization  →  Bearer <paste secret here>  (value tab)
    │         Content-Type   →  text/plain                  (value tab)
    │         X-Huddle-Date  →  @{variables('huddleDate')}  (value tab, @{} syntax)
    │         X-Huddle-Filename → @{body('filter_array_1')[0]?['name']}  (value tab)
    │       Body: @{outputs('attachment')}  (value tab, @{} syntax — NOT expression tab)
    │
    └── NO branch (morning/DOCX email):
        ├── Filter array: filter_array_2
        │   From: triggerOutputs()?['body/attachments']
        │   Condition: item()?['contentType']  is equal to
        │     application/vnd.openxmlformats-officedocument.wordprocessingml.document
        │             (LEFT = expression tab; RIGHT = value tab)
        │
        ├── Compose: attachment
        │   body('filter_array_2')[0]?['contentBytes']
        │
        └── HTTP action (Premium)
            (same structure as YES branch but references filter_array_2)
```

### Critical Power Automate gotchas

**1. Expression tab vs value tab** — Getting this wrong silently breaks the flow:

| What you're entering | Which tab |
|---------------------|-----------|
| `item()?['contentType']` — left side of filter condition | Expression |
| `application/pdf` — right side of filter condition | Value |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — DOCX filter | Value |
| `body('filter_array_1')[0]?['contentBytes']` — Compose source | Expression |
| The Cloud Function URL | Value |
| `Bearer <secret>` — Authorization header value | Value |
| `text/plain` — Content-Type header value | Value |
| `@{variables('huddleDate')}` — X-Huddle-Date header value | Value (the @{} syntax works in value tab) |
| `@{body('filter_array_1')[0]?['name']}` — X-Huddle-Filename | Value |
| `@{outputs('attachment')}` — HTTP body | Value |

**2. Filter array returning empty — the most common failure**
If `body('filter_array_1')[0]` throws "array index 0 cannot be selected from empty array":
- Left side of filter condition must be on **expression** tab (value tab compares literal string)
- DOCX MIME type is 71 characters and easy to mistype
- "From" field must reference `triggerOutputs()?['body/attachments']` directly

**3. London timezone** — The Compose action must be named `London_time` (underscore, not space). Action names with spaces cause `InvalidTemplate` errors.

```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'], 'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
```
Note: `'GMT Standard Time'` has spaces — `'GMTStandardTime'` is invalid.

**4. `@{}` syntax in value tab** — Use `@{expression}` syntax to reference dynamic values in header/body fields while on the value tab. Do not switch to expression tab.

**5. HTTP action body** — Cannot reference a Compose action by name inside the action's own "inputs" scope. Always prepare the value in a separate Compose action first.

### Condition logic

```
greater(int(formatDateTime(outputs('London_time'), 'HH')), 12)
```

Yes branch (after noon) → PDF. No branch (before noon) → DOCX.

### Firestore Security Rules — `huddles` collection

```
match /huddles/{docId} {
  allow read: if true;   // all authenticated staff can read huddle links
  allow write: if false; // writes only via Cloud Function (server-side Admin SDK)
}
```

The Admin SDK bypasses Security Rules — `allow write: if false` never blocks Cloud Functions.

### Next steps for huddle viewer UI

When building the viewer in admin.html:
- Query `huddles` collection, order by `date` descending
- Display date, file type badge, download link via `storageUrl`
- `storageUrl` already contains the access token — open directly in new tab
- Admin-only section (check `CONFIG.ADMIN_NAMES.includes(currentUser)`)

---

## Weekly Roster Upload — full detail

### Cloud Function — `parseRosterPDF`

- **Region:** `europe-west2` (London)
- **Auth:** `Authorization: Bearer <ROSTER_SECRET>`
- **AI model:** `claude-haiku-4-5-20251001`, `max_tokens: 8192`
- **Why direct PDF input:** Text extraction (pdf-parse) destroys table column structure and causes day-column misalignment. Claude reads the visual layout directly.

**Request format:**

```
Headers:
  Authorization:   Bearer <ROSTER_SECRET>
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
  shiftValueToOverrideType(value, baseShift) → Firestore type field
  Strip "RDW|" prefix → save plain time as value
  source: 'roster_import' on all saved docs
```

---

## Firebase Auth migration — full detail

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

`nameToEmail(name)` in `firebase-client.js` and `functions/index.js` must stay in sync with `getSurname()` in `admin-app.js`.

The `@myb-roster.local` domain is synthetic — not real email addresses. Firebase Auth accepts them as valid email format.

### Phase 2 — completing the migration (step-by-step)

**Step 1 — create all Firebase Auth accounts:**

Open admin.html → scroll to **Staff Login Accounts** → click **Set up accounts**.

Shows summary: created / already existed / failed. Proceed only when failed = 0.

**Step 2 — deploy Firestore rules:**

GitHub → Actions → **Deploy Firestore Rules** → Run workflow.

Uses `deploy-rules.yml` and the existing `FIREBASE_SERVICE_ACCOUNT` secret. No Firebase CLI needed.

**Do not run Step 2 before Step 1** — all Firestore writes will fail and the app breaks for everyone.

### What was implemented in v7.61

- **`firebase-client.js`**: Added Firebase Auth SDK. Exports `auth`, `signInWithEmailAndPassword`, `signOut`, `nameToEmail(fullName)`.
- **`admin-app.js`**: After localStorage login, fire-and-forgets `signInWithEmailAndPassword`. Sign-out calls Firebase `signOut`.
- **`functions/index.js`**: `setupRosterAuth` Cloud Function creates accounts for all roster members (idempotent).
- **`firestore.rules`**: Updated to require `request.auth != null` for all writes. **Not yet deployed.**
