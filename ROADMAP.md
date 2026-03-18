# MYB Roster — Product Roadmap

*Last updated: March 2026 — v5.55 (Huddle Phase 1 complete; Phase 2 written)*

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

#### Phase 2 — Automated upload

**Goal:** Remove the daily manual step. The PDF should appear in the app automatically when the Huddle email arrives, with no admin action required.

**Trigger for building this:** Phase 1 has been running reliably for a few weeks and the manual upload is confirmed as the only friction point. Do not automate until the end-to-end flow is understood from real use.

---

##### Step 1 — Identify the Huddle email pattern

Before writing any automation, establish:
- Which email address sends the Huddle (the `From:` address)
- Whether the subject line is consistent (e.g. always contains "Huddle" or a route code)
- Whether the PDF is always the only attachment, or mixed with other files
- Whether emails arrive 7 days a week or only on operating days

This determines which automation option is viable and how to write the filter rule.

---

##### Step 2 — Choose an automation route

**Option A — Google Apps Script (preferred if a Gmail account is used for Huddle emails)**

Apps Script is Google's free scripting environment, built into Google's cloud. It has direct API access to Gmail and runs entirely on Google's infrastructure — no server, no cost.

Script logic (~50 lines of JavaScript):
1. Search Gmail for emails from the known Huddle sender with a PDF attachment
2. Skip any already labelled "huddle-processed" (Gmail label used as a done-flag)
3. Extract the PDF attachment as a byte array
4. Upload to Firebase Storage via the Storage REST API (plain HTTP — no SDK needed)
5. Write the Firestore document via the Firestore REST API
6. Apply the "huddle-processed" label so the email is not re-processed next run

**Trigger options:**
- Time-based: run every 30–60 minutes (simplest — catches the email within the hour)
- Gmail push trigger: near-instant processing when the email arrives (slightly more complex to set up)

**Cost:** £0. Runs entirely on Google's free tier.

**What Claude will need to write this:**
- The confirmed `From:` address and subject pattern
- The Firebase project ID (already known — in `firebase-client.js`)
- A Firebase service account key (JSON) — created in the Firebase console under Project Settings → Service Accounts → Generate new private key. This key stays in Apps Script's script properties (encrypted), never in the codebase.

---

**Option B — Microsoft Power Automate (if Outlook / Microsoft 365 is used)**

Flow: *When email arrives matching [sender] → get attachment → HTTP PUT to Firebase Storage → HTTP POST to Firestore*

Power Automate is included in most Microsoft 365 subscriptions (Chiltern Railways likely has this). GUI-based, no code to write. The HTTP steps need the Firebase Storage and Firestore REST URLs constructed from the project ID.

**When to choose this:** If the Huddle email goes to an Outlook inbox rather than Gmail.

---

**Option C — Make or Zapier (third-party automation)**

Both platforms connect Gmail/Outlook to Firebase via HTTP actions using a point-and-click interface.

- **Make** (formerly Integromat): free tier handles 1,000 operations/month — more than enough for one PDF per day.
- **Zapier**: free tier caps at 100 tasks/month (~3 months of daily Huddles before hitting the limit).

**When to choose this:** If neither Apps Script nor Power Automate is accessible, or if a no-code solution is preferred. Introduces a dependency on a third-party service.

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
uploadedBy  string     memberName of uploader (admin); "apps-script" for automated uploads
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

### Notifications
**What:** Staff notified when a spare is assigned or a request is approved. Supervisor notified when requests arrive.

**Depends on:** Firebase Cloud Functions — requires upgrading to Blaze (pay-as-you-go) plan. Small cost but billing must be enabled. Approval workflows should exist first.

**iOS note:** PWA push notification reliability on iOS should be assessed in real use. Poor iOS delivery is a trigger to consider native app conversion (see below).

**Alternative:** In-app status checking may be sufficient. Many teams operate without push notifications.

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
