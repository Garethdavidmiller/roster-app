# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: May 2026 — v9.92 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## Security

### localStorage session can be forged for UI access (#14)
The `myb_admin_session` localStorage session can be modified via DevTools to
impersonate another user or gain the admin UI. Since v7.94, Firestore security
rules are deployed and require a real Firebase Auth session for all writes — so a
forged localStorage session can see the UI but cannot write to Firestore.
Practical risk is low for a small known team.

### ROSTER_SECRET — resolved (v9.88)
`setupRosterAuth` now uses Firebase ID token auth exclusively. No secret is hardcoded
in browser code. `admin-auth.js` calls `getIdTokenResult(true)` to get a fresh signed
JWT from Firebase and sends that as the bearer token. The Cloud Function verifies it
server-side with the Firebase Admin SDK. The `ROSTER_SECRET` value in Firebase Secret
Manager can be deleted if no longer needed for other purposes.

### ⏰ Three tasks scheduled for v10.5

Do all three together when the app reaches v10.5.

**1. Firebase web API key — restrict to HTTP referrers**
The key is visible in page source (normal for client-side Firebase). Without a GCP referrer
restriction it could theoretically be used to brute-force Firebase Auth from any origin.
Risk is low: Firestore rules require a valid Auth session for all writes, and login rate
limiting (v9.53) is in place.
**To fix (5-minute manual step — cannot be done by Claude):** GCP Console → APIs & Services
→ Credentials → find the Firebase web API key → add `myb-roster.firebaseapp.com` and
`myb-roster.web.app` as HTTP referrer restrictions.

**2. Firestore security rules — member write isolation**
Any logged-in staff member can currently write or delete overrides for any other member's
name. The rule checks `request.auth != null` but not whose session it is.
**To fix (Claude-implementable, ~half a day):**
- Add `request.resource.data.memberName == request.auth.token.name` to the `overrides`
  and `memberSettings` write rules, with an admin custom-claim bypass for G. Miller
- Add the same guard to `allow delete` on `overrides`
- Add `source` field validation: `in ['manual', 'roster_import']`
- Test that the admin custom claim correctly bypasses member restrictions before deploying

**3. Back pay HPP — check variable pay split against a payslip**
Back pay covers both basic pay/London Allowance (no HPP) and variable components
(overtime, RDW, Sundays — which do accrue HPP). The calculator adds the full lump sum
to gross for take-home but does not include any of it in the HPP accumulator, so the
HPP estimate will be slightly low after a back pay event.
**To check (human action — requires a payslip):** After the next back pay event, check
whether Chiltern's payslip shows a breakdown of the lump sum between basic and variable
components. If it does, a "Variable pay portion" field can be added to the back pay card
to feed the variable amount into HPP. If Chiltern show only a single back pay line with
no breakdown, the calculator cannot do better than it currently does.

---

## Pay calculator

### Not a payslip replacement
The calculator estimates take-home pay from staff-entered data. Actual payslips from
Chiltern may differ due to arrears, adjustments, and deductions not captured here.

### 2026/27 pay rates not confirmed
`GRADES` in `paycalc-calc.js` has placeholder 2026/27 rates. Update when the pay
award is announced. The UI shows a yellow "rate unconfirmed" notice for 2026/27 periods.
Pay awards at Chiltern are typically not decided until August — do not expect confirmed
rates before then.

### Back pay lump sum not fully included in HPP estimate
The back pay card adds the lump sum to gross for the paid-in period's take-home
calculation, but `calcHPP()` does not include any of it in the HPP accumulator.
Back pay covers both basic/London Allowance (no HPP) and variable components
(overtime, RDW, Sundays — which do accrue HPP), so the HPP estimate will be slightly
low after a back pay event. See the v10.5 task block above for the check and fix plan.

### Pre-fill reads base roster + Firestore overrides only
The "Fill from roster" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

### Firestore composite index — resolved (v10.05)
`fetchOverridesForPeriod` now queries with `memberName == memberName AND date >= start AND date <= cutoff`.
The required composite index on `overrides` (memberName ASC, date ASC) is defined in
`firestore.indexes.json` and deployed via the `deploy-rules.yml` workflow.

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

### `startDate` suppression — resolved (v10.04)
`getBaseShift()` returns `'RD'` for dates before a member's `startDate`. Firestore
overrides are now also suppressed before that date in all three calendar read paths
(personal calendar, Team Week View, and shift-type month summary) in `app.js`.

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

### Cloud Function payday constant duplicated from `roster-data.js`
`functions/index.js` contains its own `FIRST_PAYDAY_MS` and `INTERVAL_DAYS` constants
for the pay-reminder scheduled notification. These must stay in sync with `CONFIG.FIRST_PAYDAY`
and `CONFIG.PAYDAY_INTERVAL_DAYS` in `roster-data.js`. If the pay schedule ever changes,
both files must be updated. The correct long-term fix is a shared JSON config consumed by
both, but the no-build constraint makes this awkward. For now: if you change payday config,
search for `FIRST_PAYDAY_MS` in `functions/index.js` and update it in the same commit.

### Cloud Function staff list duplicated from `roster-data.js`
`functions/index.js` contains a hardcoded `STAFF_NAMES` object used by `parseRosterPDF`
to name-match the AI-parsed roster output. This must stay in sync with `teamMembers` in
`roster-data.js`. Every new starter or leaver needs updating in both files. The code
comment in `functions/index.js` acknowledges this. For now: when adding or removing a
member, search `functions/index.js` for `STAFF_NAMES` and update the relevant grade array
in the same commit.

### Legacy override types still in Firestore
Types `"allocated"`, `"overtime"`, `"swap"` are no longer creatable via the UI but
exist in older Firestore documents. They are displayed with their original labels in
Saved Changes. Editing them re-saves as `"shift"`.

The pay suggestion engine (`getRosterSuggestion` in `paycalc-roster-suggestions.js`)
reads the `type` field to classify shifts. Legacy types are treated as plain `"shift"`
overrides — they will not be miscounted, but any overtime/RDW semantics the original
type implied are lost. Clean up legacy documents in the Firebase Console to replace
them with the correct current types if the pay suggestion is producing wrong results.
