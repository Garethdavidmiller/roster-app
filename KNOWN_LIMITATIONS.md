# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: May 2026 — v11.66 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## Security

### Huddle Firestore writes restricted to admin (v11.07)
`firestore.rules` now requires `request.auth.token.admin == true` for all browser
create/update/delete on the `huddles` collection. Prior to v11.07, any signed-in staff
member could alter huddle metadata (storageUrl, fileType, htmlContent) even though
Storage rules prevented them from uploading files. The two rules now match: both Storage
and Firestore require admin claim for huddle writes. Cloud Function writes via Admin SDK
bypass rules and are unaffected.

### CSP connect-src includes firebasestorage.googleapis.com (v11.07)
Firebase Storage browser uploads (manual Huddle upload in Operations) use
`firebasestorage.googleapis.com`. This was implicitly covered by `https://*.googleapis.com`
but is now also listed explicitly in `connect-src` in `firebase.json` for clarity.
Both `connect-src` and `img-src` explicitly list `https://firebasestorage.googleapis.com`.

### localStorage session can be forged for UI access (#14)
The `myb_admin_session` localStorage session can be modified via DevTools to
impersonate another user or gain the admin UI. Since v7.94, Firestore security
rules are deployed and require a real Firebase Auth session for all writes — so a
forged localStorage session can see the UI but cannot write to Firestore.
Practical risk is low for a small known team.

### Firebase Auth session is re-established on page load (v10.93)
A returning user with a valid 30-day localStorage session skips the login click handler on
every subsequent open, which would leave `auth.currentUser` null and break all Firestore
writes. Fixed in v10.93 by `ensureFirebaseSession()`, which runs on page load whenever a
localStorage session exists (waits for `onAuthStateChanged`, signs in if none found,
self-heals a missing account). Full description and the "do not remove this call" rule:
**CLAUDE.md → "Firebase Auth (complete — v7.94)"**.

### ⏰ The four v11 security tasks — current status

Originally pencilled in for v10.50, deferred to v11. Status as of v11.39:
**#1 done** (with a critical allowlist caveat — see below) · **#2 suspended** (caused a
production outage) · **#3 done** · **#4 awaiting verification on a real payday**.

**1. Firebase web API key — restrict to HTTP referrers ✓ DONE (May 2026) ⚠️ SEE NOTE**
The key is visible in page source (normal for client-side Firebase). Without a GCP referrer
restriction it could theoretically be used to brute-force Firebase Auth from any origin.
**Applied manually in GCP Console:** APIs & Services → Credentials → Firebase web API key →
HTTP referrer restrictions set to `myb-roster.firebaseapp.com/*` and `myb-roster.web.app/*`.
Verified with curl: 403 for requests without a `Referer` header, 403 for a bad origin
(`evil.com`), 400 (reached Firebase — key accepted, credentials invalid as expected) for the
correct origin (`myb-roster.web.app`). Restriction is working correctly.

**⚠️ CRITICAL — all served domains must be in the allowlist (v10.95):**
In May 2026 the referrer restriction was found to be blocking **all** Firebase Auth calls
from `garethdavidmiller.github.io` — the domain staff actually use — because only the two
Firebase-issued domains were added to the allowlist, not the GitHub Pages / custom domain.
Every sign-in attempt threw `auth/requests-from-referer-...-are-blocked`, making every
Firestore write fail silently for all users.

**Fix:** In GCP Console → APIs & Services → Credentials → Firebase web API key, add every
domain the app is served from. Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*`

If you ever add a custom domain, add it here too — or ALL Firebase Auth and API calls
will silently fail for users on that domain, with no visible error in the app UI.

**2. Firestore security rules — member write isolation ⚠️ SUSPENDED (v10.94)**
Originally implemented in v10.72 (`firestore.rules`). Per-member write isolation required
every write to carry a custom JWT claim (`request.auth.token.name` = memberName,
`request.auth.token.admin` = true for G. Miller), set server-side by `setupRosterAuth`.

**Why it was reverted (v10.94):** Two cascading bugs caused a full production outage:

1. **setupRosterAuth bug (v10.88 fixed):** The Cloud Function only ever set `{ admin: true }`
   for G. Miller — it never set the `name` claim for anyone. So every staff member's
   writes failed the isolation check, not just non-admins.

2. **Page-load Firebase Auth session bug (v10.93 fixed):** The Firebase Auth sign-in only
   ran inside the login click handler. A returning user with a valid 30-day localStorage
   session never hit that handler, so `auth.currentUser` was persistently null — breaking
   both the Firestore writes (no session at all) and the "Set up accounts" button needed to
   fix the claims. A classic deadlock.

With both bugs fixed, the claims path could technically work. However, it still requires
a multi-step manual recovery (Set up accounts → sign out/in → Set up accounts again →
all staff sign out/in). During an active outage, that fragility is unacceptable.

**Current state (v10.94):** Rules reverted to `request.auth != null` — any signed-in
staff member may write, matching the pre-v10.72 model that ran without incident for
months. Field validation (type whitelist, size limits, required keys) is still enforced
for data integrity.

**To re-introduce (deferred to a future version):**
- Confirm `setupRosterAuth` reliably sets `name` claims for all staff (v10.88 fixed this)
- Confirm page-load Firebase Auth session is reliably established (v10.93 fixed this)
- Re-add the per-member claim checks to `firestore.rules`
- Deploy rules and run "Set up accounts" to ensure all tokens carry the claim
- Test that every staff member can write their own overrides before deploying to prod

**3. Back pay HPP — check variable pay split against a payslip**
Back pay covers both basic pay/London Allowance (no HPP) and variable components
(overtime, RDW, Sundays — which do accrue HPP). The calculator adds the full lump sum
to gross for take-home but does not include any of it in the HPP accumulator, so the
HPP estimate will be slightly low after a back pay event.
**✓ DONE (v10.73):** Confirmed from G. Miller's period 32 (Oct 2025) payslip — Chiltern
itemises each back pay line with an explicit `(Back Pay)` suffix per category (Basic Pay,
Overtime 1.25, RDW 1.25, RDW Sun 1.5, Bank Holiday Rostered 1.25, etc.). No new UI field
was needed — `calcBackPay()` already iterates saved period data by category, so
`_bpVarAmount` is computed automatically. `calcHPP()` now adds `_bpVarAmount` to
`totalVar` for the paid-in period so the HPP estimate is correct after a back pay event.

**4. Pay reminder push notification — infrastructure fixed May 2026 ✓ AWAITING LIVE VERIFICATION**
`sendPayReminderNotification` did not fire on 30 May 2026 because the Cloud Scheduler job
had never been created. Root causes (both fixed in May 2026):
- The `FIREBASE_SERVICE_ACCOUNT` lacked `roles/cloudscheduler.admin` — deployment failed
  silently trying to manage the scheduler job.
- A stale `us-central1` deployment record blocked redeployment (the function had initially
  deployed to us-central1 before the region was set to `europe-west2`). Deleted manually
  from Firebase Console, then redeployed cleanly.
The Cloud Scheduler job `firebase-schedule-sendPayReminderNotification-europe-west2` now
exists. A force-run on 31 May confirmed the function executes and correctly skips on
non-cutoff days (`[payReminder] Not a cutoff date — skipping`).
**Next live test: Saturday 27 June 2026** (cutoff for the 3 Jul payday). If the notification
arrives, mark this done. If not, check Firebase Console → Functions → Logs for that date.

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

### Back pay lump sum — HPP now included (v10.73)
Resolved — `calcBackPay()` computes the variable-pay portion (`_bpVarAmount`) and
`calcHPP()` folds it into the HPP estimate for the paid-in period. See task #3 above for the
payslip confirmation detail.

### Pre-fill reads base roster + Firestore overrides only
The "Fill from roster" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

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

---

## Navigation / accessibility

### Keyboard focus trap is panel-only (not full ARIA modal)
The nav panel traps Tab/Shift+Tab within its focusable elements while open (v10.69), and the coming-soon lightbox also traps Tab focus to its single close button. Both elements are declared `role="dialog" aria-modal="true"` (v10.80). Screen-reader users can still reach page content behind the overlay via browse mode — `inert` on background content is deferred. The app is staff-only on mobile (primarily Android), where VoiceOver/TalkBack bypass risks are low.

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
15 lunar/lunisolar datasets need updating each November/December. Full list and
sources in `CLAUDE.md` → "Annual maintenance — cultural calendar data".

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
