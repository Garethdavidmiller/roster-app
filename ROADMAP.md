# MYB Roster — Product Roadmap

*Last updated: April 2026 — v6.28 (Push notifications live; Allocated shift type; startDate/proRatedAL member fields; guide.html added)*

---

## Completed phases

### Phase 1 — Firestore read layer ✓
Owner manually enters shift overrides. App reads and overlays them on the base roster. No user logins required.

### Phase 2 — Staff self-service portal ✓
Individual staff log in and enter their own overrides. Admin (G. Miller) has elevated access.

**What was built:**
- admin.html — self-service portal for all staff plus admin tools
- Individual login per staff member (name + surname password)
- AL booking with entitlement tracking (32 days CEA, 34 days CES/Dispatcher/Fixed)
- Bulk override operations and override history
- Cultural calendar marker preference per member (Islamic, Hindu, Chinese, Jamaican, Congolese, Portuguese)
- Dispatcher and fixed roster types
- Firestore security rules — server-side validation of all writes

**Auth note:** The original plan specified Firebase Auth (Microsoft SSO or email/password). The implementation uses a simpler surname-based password with localStorage sessions. This was a deliberate divergence — no Chiltern IT dependency, no registration flow, works immediately for all staff. If stronger authentication is ever needed, see #14 in CLAUDE.md.

---

## Future capabilities — optional, no fixed sequence

Nothing below is committed. Each area is independent unless a dependency is noted.

---

### Daily Huddle viewer

**What:** Each morning a "Huddle" PDF arrives by email — it lists the day's responsibilities across the team. Staff can open the latest Huddle directly from the app without finding the email.

---

#### How it works (end-to-end)

```
Huddle email arrives in inbox
         ↓
Upload PDF to Firebase Storage
(manual via admin.html — Phase 1 ✓ | automated via Apps Script — Phase 2)
         ↓
Firestore records metadata:
  { date: "YYYY-MM-DD", storageUrl: "...", uploadedAt: timestamp, uploadedBy: "G. Miller" }
         ↓
App calls getLatestHuddle() on load
         ↓
📋 Huddle button appears in controls bar — tap to open in native PDF viewer
```

---

#### Phase 1 — Manual upload ✓ Complete (v5.53–v5.55)

**What was built:**

| Component | Detail |
|-----------|--------|
| Firebase Storage | Enabled. Path: `huddles/YYYY-MM-DD.pdf`. Overwrites on same-day re-upload (latest wins). |
| `uploadHuddle(date, file, uploadedBy)` | In `firebase-client.js`. Uploads to Storage, writes Firestore doc. |
| `getLatestHuddle()` | In `firebase-client.js`. Queries `huddles` ordered by date desc, returns most recent doc. Validates `storageUrl` present before returning. |
| `getTodaysHuddle(date)` | In `firebase-client.js`. Exported — available for Phase 2 if the distinction between "today's" and "latest" becomes important. |
| Upload UI | Collapsible card in `admin.html`, admin-only (`CONFIG.ADMIN_NAMES` guard). Date picker + PDF chooser + "Upload Huddle" button. |
| Client-side validation | JS rejects non-PDF files and files over 20 MB before any upload attempt. |
| `📋 Huddle` button | In `index.html` controls bar. Hidden until a huddle exists; calls `window.open(storageUrl)` to hand PDF to the device's native viewer. |
| Firestore security rules | `huddles` collection: reads open; writes require all fields present and `date` in `YYYY-MM-DD` format. |

**Design decisions made:**

- `getLatestHuddle()` rather than `getTodaysHuddle()` — the button shows whatever was most recently uploaded, even if it was yesterday's. This is intentional: if the Huddle arrives late or upload is delayed, staff still see something rather than nothing.
- `window.open()` rather than an iframe — iframes with PDFs are unreliable on Android/iOS. Native viewer handles pinch-zoom correctly with no library needed.
- File stored at `huddles/YYYY-MM-DD.pdf` — simple, one file per calendar day, no versioning complexity.

---

#### Phase 2 — Automated upload ✓ Complete (v5.66)

**Goal:** Remove the daily manual step. The PDF appears in the app automatically when the Huddle email arrives, with no admin action required.

**What was built:** Cloud Function `ingestHuddle` in `functions/index.js`. Power Automate flow triggers on the Huddle email, filters attachments by type, and POSTs the file (base64-encoded) to the Cloud Function with metadata in custom headers.

**How it works (redesigned in v6.x):**
- Condition sets only `huddleDate`: afternoon emails (after noon) → tomorrow's date; morning emails → today's date.
- After the condition, a single Filter Array accepts both `.pdf` and `.docx` using an OR expression on file extension: `or(endsWith(toLower(item()?['name']), '.pdf'), endsWith(toLower(item()?['name']), '.docx'))`
- One HTTP action sends the matched attachment — no time-based PDF/DOCX branching (previous approach failed when DOCX arrived after noon)
- Cloud Function stores the file in Firebase Storage and writes a Firestore `huddles` doc
- The `📋 Huddle` button in index.html picks up the latest doc automatically

**Key design decisions:**
- Raw base64 body with metadata in headers — Power Automate silently truncates large strings in JSON bodies; raw body bypasses this
- Both PDF and DOCX handled natively by Power Automate — no conversion service needed (see note below re: conversion problem)
- `uploadedBy: "power-automate"` on all automated uploads

---

##### Step 1 — Identify the Huddle email pattern ✓

Confirmed:
- Sender varies (multiple addresses) — filter by subject, not sender
- Subject always contains "huddle"
- Both PDF and DOCX attachments arrive together — prefer PDF, fall back to DOCX

---

##### The conversion problem — RESOLVED

> **Note (v5.66):** This section was written before Phase 2 was built. The conversion problem was solved differently from what was anticipated here. Power Automate handles both PDF and DOCX natively — both file types are stored as-is in Firebase Storage (DOCX as `.docx`, PDF as `.pdf`). The app displays whichever was uploaded. No conversion step was needed. The Apps Script option below was never implemented.

The Huddle arrives as a **.docx (Word) attachment**, not a PDF. During Phase 1, the admin converts it manually before uploading. Phase 2 must handle this conversion automatically — the app stores and serves PDFs, so the automation needs to convert the Word document as part of the pipeline.

This actually makes **Google Apps Script the strongest option**, because Google Drive can convert a Word document to PDF with a single API call — no third-party conversion service needed.

---

##### Step 2 — Choose an automation route

**Option A — Google Apps Script �recommended (works with Gmail; handles docx → PDF natively)**

Apps Script is Google's free scripting environment, built into Google's cloud. It has direct API access to Gmail and Google Drive, and runs entirely on Google's infrastructure — no server, no cost.

The conversion trick: Google Drive's API can import a `.docx` file and immediately export it as a PDF in the same operation. This is the same thing Google does when you open a Word file in Google Docs and click File → Download → PDF — Apps Script can do it programmatically.

Script logic (~60 lines of JavaScript):
1. Search Gmail for emails from the known Huddle sender with a `.docx` attachment
2. Skip any already labelled `"huddle-processed"` (Gmail label used as a done-flag)
3. Extract the `.docx` attachment as a byte array
4. Upload it to Google Drive as a Google Doc (Drive converts it automatically on import)
5. Export the Google Doc as a PDF byte array (one API call)
6. Delete the temporary Google Doc from Drive (no clutter left behind)
7. Upload the PDF to Firebase Storage via the Storage REST API
8. Write the Firestore document via the Firestore REST API
9. Apply the `"huddle-processed"` label so the email is not re-processed next run

**Trigger options:**
- Time-based: run every 30–60 minutes (simplest — catches the email within the hour)
- Gmail push trigger: near-instant processing when the email arrives (slightly more complex to set up, but means staff see the Huddle as soon as it hits the inbox)

**Cost:** £0. Runs entirely on Google's free tier. Drive storage used is temporary (deleted in step 6).

**Confirmed email pattern:**
- Sender: varies (multiple addresses send the Huddle) — do not filter by sender
- Subject: always contains "huddle" — use subject filter in the trigger
- Attachments: both PDF and DOCX arrive together — prefer PDF, fall back to DOCX

**What Claude will need to write this:**
- The Firebase project ID (already known — in `firebase-client.js`)
- A Firebase service account key (JSON) — created in the Firebase console under Project Settings → Service Accounts → Generate new private key. This key is stored in Apps Script's Script Properties (encrypted storage), never in the codebase.

---

**Option B — Microsoft Power Automate (if the Huddle email goes to an Outlook inbox)**

Power Automate is included in most Microsoft 365 subscriptions (Chiltern Railways likely has this). GUI-based, no code to write.

Flow: *When email matching [sender] arrives → get .docx attachment → convert to PDF (OneDrive "Convert file" action) → HTTP PUT to Firebase Storage → HTTP POST to Firestore*

The conversion step uses Power Automate's built-in OneDrive connector, which can convert Word documents to PDF without any external service. The result is then sent to Firebase via plain HTTP actions.

**When to choose this:** If the Huddle email arrives in an Outlook inbox rather than Gmail, and Microsoft 365 is available.

**Limitation:** The HTTP steps require manually constructing the Firebase Storage and Firestore REST URLs. Slightly more fiddly than Apps Script but no code is written.

---

**Option C — Make or Zapier + conversion service (third-party, last resort)**

Neither Make nor Zapier has native docx-to-PDF conversion. An intermediate step via a conversion API (e.g. CloudConvert, which has a free tier) would be needed, making the flow:

*Email arrives → get attachment → POST .docx to CloudConvert → receive PDF → upload to Firebase Storage → write Firestore doc*

- **Make**: free tier handles 1,000 operations/month — comfortably covers one multi-step flow per day.
- **Zapier**: free tier caps at 100 tasks/month — would be exhausted quickly given the number of steps per Huddle.

**When to choose this:** Only if Gmail is not available and Microsoft 365 is not accessible. Introduces dependencies on two third-party services (Make/Zapier and a conversion API).

---

##### Admin upload (Phase 1 holdover)

The manual upload UI in admin.html currently accepts PDF only. If Phase 2 automation is in place, manual upload becomes a fallback for days when automation fails. Two options:

- **Keep PDF-only upload:** Admin converts manually as a fallback (same as Phase 1). Simple, no code change.
- **Accept .docx in the upload UI and convert in-browser:** Browser-side docx-to-PDF conversion requires a heavy library (~2 MB). Not worth the complexity for an occasional fallback. **Recommended: keep PDF-only.**

---

##### Step 3 — App-side changes for Phase 2

The `📋 Huddle` button already works. The only change needed is deciding whether to distinguish "today's huddle" from "latest huddle":

| Scenario | Current behaviour | Possible Phase 2 change |
|----------|------------------|------------------------|
| Huddle uploaded for today | Button visible | Could add "Today" label or highlight |
| No huddle today, yesterday's exists | Button visible (shows yesterday's) | Could show date of huddle so staff know it's not today's |
| No huddle at all | Button hidden | No change needed |

**Recommendation:** Add the huddle date to the button tooltip or as a small sub-label (e.g. `📋 Huddle · Mon 18 Mar`). This makes it immediately clear whether the huddle is current without changing the tap-to-open behaviour.

This is a small `app.js` change — `getLatestHuddle()` already returns the `date` field.

---

##### Step 4 — Archive / history view (optional, low priority)

Once automated, the `huddles` Firestore collection will accumulate documents. A simple archive could be added to admin.html:

- A date-picker that fetches the huddle for a chosen date
- Or a scrollable list of recent dates with a tap-to-open link

This is not needed for day-to-day use — staff only need today's Huddle. Consider only if supervisors ask for it.

---

#### Firestore schema (unchanged from Phase 1)

Collection: `huddles` — one document per date, document ID = `"YYYY-MM-DD"`:

```
date        string     "2026-03-18"
storageUrl  string     Firebase Storage download URL
uploadedAt  timestamp  Firestore server timestamp
uploadedBy  string     memberName of uploader (admin); "power-automate" for automated uploads
```

#### Firebase Storage path (unchanged from Phase 1)

```
huddles/YYYY-MM-DD.pdf
```

One file per calendar day. Same-day re-upload overwrites (latest version wins).

---

#### Security rules (Phase 2 addition)

The Phase 1 Firestore rules allow any valid write. For Phase 2, the Apps Script uses a service account — consider restricting Firestore `huddles` writes to require a valid Firebase Auth token (service account JWT) rather than open writes. This is optional if the Firestore rules already validate the document shape.

Storage rules remain unchanged: authenticated write, open read.

---

### Weekly Roster Upload ✓ Complete (v5.77–v5.91)

**What:** Admin uploads the weekly PDF roster. Claude AI reads the table and extracts each person's shifts. The app compares against the base roster and existing overrides, shows a per-person review UI, and saves only the changes the admin approves.

**What was built:**

| Component | Detail |
|-----------|--------|
| `parseRosterPDF` Cloud Function | Receives base64 PDF, calls Claude AI (claude-haiku) with the PDF as a document content block (preserves table structure), returns parsed shifts as JSON |
| AI prompt | Day-to-date mapping, shift code glossary, RDW/AL/NA format variants, duty code ignore rules, Sunday=RD rule |
| `normaliseShift()` | Canonicalises AI output: `"RDW HH:MM-HH:MM"` → `"RDW|HH:MM-HH:MM"` (pipe-encoded, stripped before Firestore save) |
| `computeCellStates()` | Classifies each parsed day as MATCH / DIFF / CONFLICT / COVERED against base roster and existing overrides |
| Review UI | Per-person card list — approve/skip per day, conflict detection with manual-vs-PDF toggle |
| `shiftValueToOverrideType()` | Maps parsed value to Firestore override type (`rdw`, `annual_leave`, `spare_shift`, `correction`, `overtime`, `sick`) |
| `source: 'roster_import'` | All auto-applied overrides tagged so a later upload doesn't treat them as manual conflicts |

**Key design decisions:**

- **Direct PDF input to Claude** rather than text extraction — pdf-parse destroys table column structure; Claude reads the visual layout and correctly maps day columns
- **`RDW|HH:MM-HH:MM` internal encoding** — preserves the RDW flag through the review pipeline so RDW is identified correctly even on SPARE weeks (where `baseShift` is not `'RD'`)
- **`source: 'roster_import'`** on saved docs — distinguishes auto-applied from hand-entered overrides; previous imports are always replaced cleanly by a new upload

**Auth:** `Authorization: Bearer <ROSTER_SECRET>` — same pattern as Huddle ingest. See CLAUDE.md for full request format.

---

### Payday calculator ⚙️ In progress
**What:** A view that shows the staff member's worked shifts for the current pay period, counts hours and shift types, and gives a breakdown of what contributes to pay. Paydays are every 4 weeks (Friday); the cutoff for each period is the preceding Saturday.

**What is already built:**
- `getPaydaysAndCutoffs(year)` in `roster-data.js` — calculates every payday and cutoff date for a given year, adjusts backwards if payday falls on a bank holiday
- `isPayday()` and `isCutoffDate()` helper functions, both tested
- `FIRST_PAYDAY` and `PAYDAY_INTERVAL_DAYS` in `CONFIG`
- Calendar cells already show 💷 payday and ✂️ cutoff markers
- Gareth has calculator UI work in progress externally — will be integrated when ready

**Depends on:** Nothing new. All shift data already in Firestore; pay period boundaries already calculated.

**Integration notes for when the code arrives:**
- The data layer lives in `roster-data.js` — do not duplicate it in the new file
- Any new page should follow the same file structure: `paycalc.html` (HTML+CSS only) + `paycalc.js` (JS only) + import from `roster-data.js` and `firebase-client.js`
- Add to service worker `ASSETS_TO_CACHE` and network-first list
- Version bump table will need two new rows

---

### Operational visibility
**What:** Daily deployment view — who is working, spare, or on AL across the whole team for any given day. Useful for supervisors planning cover.

**Depends on:** Nothing new. All data already in Firestore.

**Worth doing if:** Supervisors currently do this manually from the calendar view.

---

### Approval workflows
**What:** Staff submit requests (shift swaps, overtime availability). Supervisor sees pending requests and approves or declines. Outcomes recorded in Firestore.

**Depends on:** Current auth model is sufficient for submitting requests. Supervisor UI needed.

**Decision point:** How much request volume is there? If the owner currently handles a small number of changes by direct conversation, formal workflows may add process without adding value.

---

### Huddle push notifications ✓ Complete (v6.11)

**What was built:** Web Push notifications via Firebase Cloud Functions. When `ingestHuddle` stores a new Huddle, it fans out a push to every subscribed device. Staff subscribe via admin.html (a "Subscribe to Huddle notifications" toggle). VAPID keys stored in Firebase Secret Manager.

**iOS note:** Requires Safari and the app installed to the Home Screen. Android Chrome works via the browser.

**Still to assess:** Notification reliability in real daily use. If iOS delivery proves unreliable, consider native app (see below).

---

### Notifications — approval/assignment events
**What:** Staff notified when a spare is assigned or a request is approved. Supervisor notified when requests arrive.

**Depends on:** Approval workflows (below). The Cloud Function infrastructure for push is already in place — extending it to cover other event types is a smaller lift now that the foundation exists.

---

### Formal AL management
**What:** Official AL request and approval workflow with entitlement tracking across the year.

**Depends on:** Approval workflows (above).

**Important caveat:** Chiltern Railways has an official HR system for leave management. Building a parallel approval process risks conflict between the two systems. This capability should remain clearly informational unless there is explicit agreement with management that the app's approval carries official weight.

---

### Calendar export
**What:** Staff shifts available in their phone calendar.

**Two routes — do the simpler one first:**

- **.ics file export** (simple): One-click download, staff import into any calendar app manually.
  Re-import needed when roster changes, but the base roster is stable. Build this first and
  assess whether demand for automatic sync is real.

- **Automatic calendar sync** (complex): Shifts pushed directly to Google Calendar, Apple
  Calendar, or Outlook whenever the roster changes. Requires Firebase Cloud Functions and
  three separate calendar APIs. Microsoft Graph requires Chiltern IT involvement.

---

### Native app (conditional)
**Only pursue if one of these is true:**
- iOS push notification delivery is unacceptably unreliable in real use
- Chiltern IT require app store distribution via MDM
- PWA limitations are genuinely felt by users

**If pursued:** React Native. Same JavaScript language, Firebase carries over, only the UI layer needs rewriting. Requires Apple Developer account ($99/year) and Google Play ($25).

Do not build speculatively. The PWA works well for the current use case.

---

## Open decisions

**Auth hardening:** The surname password is practical for a roster app. If approval workflows or formal AL management are added, consider whether a colleague logging in as another person is an acceptable risk. Assess at the time. See #14 in CLAUDE.md for the migration plan.

**Multi-admin:** ✓ Resolved — `CONFIG.ADMIN_NAMES` is now an array in `roster-data.js`. Adding another admin is a one-line change (name must match `teamMembers[n].name` exactly).

**Official status:** Is this app sanctioned by Chiltern Railways? The more operationally critical it becomes, the more important this question is.

**GDPR:** Staff shift data is personal data. If the app becomes official infrastructure, data controller status and retention policies will need documenting.
