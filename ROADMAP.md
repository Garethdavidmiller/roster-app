# MYB Roster — Product Roadmap

*Last updated: March 2026 — v5.49 (Huddle viewer roadmap added)*

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
**What:** Each morning a "Huddle" PDF arrives by email — it lists the day's responsibilities across the team. Staff should be able to open the latest Huddle from the app without having to find the email.

---

#### How it works (end-to-end)

```
Huddle email arrives in inbox
         ↓
Upload PDF to Firebase Storage
(manual via admin.html — Phase 1 | automated via Apps Script — Phase 2)
         ↓
Firestore records metadata:
  { date: "2026-03-18", storageUrl: "...", uploadedAt: timestamp }
         ↓
App checks Firestore on load for today's date
         ↓
"Today's Huddle" card appears — tap to open in native PDF viewer
```

---

#### Phase 1 — Manual upload (build this first)

An admin-only "Upload Huddle" button in admin.html. Admin taps it, picks the PDF, it uploads to Firebase Storage and writes the Firestore record. Takes ~10 seconds. No automation required.

**What needs building:**
- Enable Firebase Storage in the Firebase console (free tier — 5 GB storage, 1 GB/day download; a daily PDF will never get close)
- `huddles` Firestore collection with documents keyed by date: `{ date: "YYYY-MM-DD", storageUrl: string, uploadedAt: timestamp }`
- Upload UI in admin.html — visible to admins only (guarded by `CONFIG.ADMIN_NAMES`)
- Firebase Storage security rules — authenticated upload, public read (or app-only read)
- "Today's Huddle" card in index.html — shown if a document exists for today's date, hidden otherwise
- Same card in admin.html if useful

**Display approach — why native PDF viewer:**
iframes with PDFs are unreliable on Android/iOS. The right approach is `window.open(storageUrl)` — this hands the PDF to the device's native viewer, which is fast and handles pinch-zoom correctly. No PDF library needed.

**File structure follows existing pattern:**
No new pages needed. Upload logic lives in `admin-app.js`. Display card lives in `app.js`. Shared Firebase calls go in `firebase-client.js`.

---

#### Phase 2 — Automated upload

Once Phase 1 is working and the display is confirmed, the manual upload step can be eliminated.

**Option A — Google Apps Script (preferred if Gmail is used)**

Google Apps Script is a free scripting environment built into Google's cloud. It has direct access to Gmail and can run on a schedule or trigger.

Script logic (approximately 50 lines of JavaScript):
1. Check Gmail for emails matching the Huddle sender/subject
2. Find any not yet processed (use a Gmail label as a "done" flag)
3. Extract the PDF attachment
4. Upload to Firebase Storage via the Firebase REST API (Storage supports plain HTTP — no SDK needed in Apps Script)
5. Write the Firestore document via the Firestore REST API
6. Apply the "done" label so the email is not processed again

Set the script to run every hour, or use a Gmail push trigger for near-instant processing. Cost: £0. No server required.

**Option B — Microsoft Power Automate (if Outlook / Microsoft 365 is used)**

Flow: *When an email matching [sender/subject] arrives → extract attachment → HTTP POST to Firebase Storage → HTTP POST to Firestore*

Power Automate is included in Microsoft 365 subscriptions (which Chiltern Railways likely has). GUI-based, no code. Cost: included.

**Option C — Zapier or Make (third-party automation)**

Both can connect Gmail/Outlook to Firebase Storage via HTTP actions. Make (formerly Integromat) has a free tier generous enough for one Huddle per day. Zapier's free tier caps at 100 tasks/month (~3 months of daily Huddles before needing a paid plan). Simpler to configure than Apps Script but introduces a dependency on a third-party service.

---

#### Firestore schema

Collection: `huddles`
One document per date, document ID = `"YYYY-MM-DD"`:

```
date        string     "2026-03-18"
storageUrl  string     Firebase Storage download URL
uploadedAt  timestamp  Firestore server timestamp
uploadedBy  string     memberName of uploader (admin only, for audit)
```

#### Firebase Storage path

```
huddles/YYYY-MM-DD.pdf
```

Simple, one file per day. If a second Huddle is uploaded on the same day it overwrites the first (intentional — latest version wins).

---

#### Security rules

Storage: allow read by anyone with the app; allow write only if the user is authenticated as an admin (tie to the same surname-password session in localStorage, or use a Firebase Storage custom token if stricter access is needed).

Firestore: `huddles` collection — allow reads; allow writes only from admin upload path (same pattern as `overrides`).

---

#### What is already in place

| Component | Status |
|-----------|--------|
| Firebase project | ✓ Exists |
| Firestore | ✓ In use |
| Firebase Storage | ✗ Not yet enabled — one toggle in Firebase console |
| `firebase-client.js` | ✓ Central place to add Storage init and upload/read functions |
| Admin auth guard | ✓ `CONFIG.ADMIN_NAMES` check already used for elevated UI |

---

#### Integration notes

- Add Storage init to `firebase-client.js` alongside the existing Firestore init — one place, same pattern
- Export `uploadHuddle(date, file)` and `getTodaysHuddle(date)` from `firebase-client.js`
- The "Today's Huddle" card should degrade silently if Storage or Firestore is unavailable — same offline-first rule as everything else
- Add `huddles` to Firestore security rules in the Firebase console alongside `overrides` and `memberSettings`
- Version bump required when this is built (two files affected: `app.js` and `admin-app.js`; possibly `firebase-client.js`)

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
