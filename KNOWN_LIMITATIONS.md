# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## Security

### Authentication is client-side only (#14 — high priority)
The `myb_admin_session` localStorage session can be forged via DevTools.
Firebase Auth is wired in (`firebase-client.js`) but the Firestore security rules
have not been deployed yet. Deploying the rules before running `setupRosterAuth`
(admin.html → Staff Login Accounts → Set up accounts) would break all Firestore writes.

**Safe order:** Set up accounts → deploy rules.

### ROSTER_SECRET is visible in page source
The bearer token for `parseRosterPDF` is hardcoded in `admin-app.js`.
The long-term fix is Firebase Auth custom claims (`request.auth.token.admin == true`).
Deferred as a known limitation. Do not rotate the secret without updating the hardcoded
value and redeploying.

---

## Pay calculator

### Not a payslip replacement
The calculator estimates take-home pay from staff-entered data. Actual payslips from
Chiltern may differ due to arrears, adjustments, and deductions not captured here.

### 2026/27 pay rates not confirmed
`GRADES` in `paycalc-calc.js` has placeholder 2026/27 rates. Update when the pay
award is announced. The UI shows a yellow "rate unconfirmed" notice for 2026/27 periods.

### Dispatcher grade not supported
Pay rates for Dispatchers are not confirmed. The grade is not in the `GRADES` object.
Do not add it until the rates are verified.

### Pre-fill reads base roster + Firestore overrides only
The "Fill from roster" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

### Firestore composite index not present
`fetchOverridesForPeriod` queries by date range only (no memberName equality filter)
because adding memberName as an equality filter alongside a date range requires a
composite Firestore index that has not been created. The function filters by member
client-side instead.

---

## Calendar / roster

### Override cache is never cleared on member switch
`rosterOverridesCache` in `app.js` is keyed `"memberName|date"` and accumulates
overrides for all members without a size limit. It is not cleared when the selected
member changes — switching members triggers a new fetch that adds to the existing map.
This is intentional (avoids redundant Firestore reads on member switch) but means the
cache grows unboundedly for long sessions where many members are viewed.

### Duplicate Firestore override documents
If a date has multiple override documents for the same member, the cache keeps the
most recently created one (by `createdAt` timestamp). Duplicates are logged via
`console.warn`. Clean up at source in the Firebase Console.

### `startDate` suppression is base-roster only
`getBaseShift()` returns `'RD'` for dates before a member's `startDate`.
Firestore overrides entered before the start date are not suppressed — if an admin
enters a shift override before a member's official start, it will appear in the calendar.

---

## PWA / service worker

### PWA shortcuts require reinstall to update
Changes to `manifest.json` shortcuts do not take effect on existing installs
until the user reinstalls the PWA (removes and re-adds to home screen).

### Service worker activates immediately (`skipWaiting`)
`self.skipWaiting()` means a new SW takes over all open tabs at once.
In the rare case this causes a mid-session race, a hard reload resolves it.

---

## Huddle ingest

### Power Automate HTTP connector is Premium
The Huddle ingest flow requires the Premium HTTP connector in Power Automate.
The standard "Send an HTTP request (Office 365)" connector does not work here.

### File type detection uses filename extension, not Content-Type
Power Automate sends `text/plain` for both PDF and DOCX attachments.
The `ingestHuddle` function detects file type from the `X-Huddle-Filename` header
extension, not from `Content-Type`.

---

## Roster data

### Cultural calendar data needs annual update
15 lunar/lunisolar calendar datasets (Islamic, Hindu, Chinese) need updating each
November/December. The Jamaican, Congolese, and Portuguese calendars are rule-based
and self-updating. See `CLAUDE.md` for the full list of datasets and sources.

### Legacy override types still in Firestore
Types `"allocated"`, `"overtime"`, `"swap"` are no longer creatable via the UI but
exist in older Firestore documents. They are displayed with their original labels in
Saved Changes. Editing them re-saves as `"shift"`.
