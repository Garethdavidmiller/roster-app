# Response to External Code Review — MYB Roster App
*Prepared June 2026 · Reviewing findings against v13.14 codebase*

Thank you for the thorough review. We've gone through every finding carefully against
the actual code. Below is our verdict on each, along with actions taken.

---

## Summary

| # | Finding | Verdict | Action |
|---|---------|---------|--------|
| 1 | Firebase session not verified against selected member | Known, documented | None required |
| 2 | Any authenticated account can alter any member's data | Known, documented | None required |
| 3 | Cultural calendar data readable by all authenticated users | Intentional design | None required |
| 4 | Huddle files effectively public | Accurate — low risk accepted | None required |
| 5 | GitHub Pages doesn't receive Firebase security headers | Accurate, platform-constrained | Noted for future migration |
| 6 | `setupRosterAuth` doesn't re-enable returning accounts | **Confirmed bug** | **Fixed in v13.15** |
| 7 | Push subscriptions allow unauthenticated creation | Intentional design | None required |
| 8 | Roster parser accepts impossible dates | Already fixed in v13.13 | Already resolved |
| 9 | Shift normalisation accepts impossible times | Low-impact, admin-reviewed path | None required |
| 10 | SW cache deletion too broad | Not applicable to this deployment | None required |
| 11 | Functions workflow can mask failed deploys | Mild, real concern | None required (low priority) |
| 12 | Focus trap misses `<input>`, `<select>`, `<textarea>` | **Confirmed code defect** | **Fixed in v13.15** |
| 13 | Unlabelled form controls | Likely partially valid | Accessibility audit queued |
| 14 | Audit docs stale (8 → 9 moderate) | Inaccurate | Docs are current |

---

## Detail

### Finding 1 — Firebase session not verified against selected staff member
**Verdict: Known, documented trade-off.**

The authentication model is deliberately simple: surname-derived passwords with Firebase
Auth rate-limiting as the primary protection. `ensureFirebaseSession` is designed this
way. This is documented in both `CLAUDE.md` and `KNOWN_LIMITATIONS.md`:

> *"Passwords are surname-derived and not secrets — protection relies on Firebase Auth
> rate-limiting (v9.53) and Firestore rules (`request.auth != null`)."*

The anonymous fallback and self-create behaviour are also documented. For a 28-person
internal team app not publicly advertised, this is an accepted constraint. The v11
security task to introduce JWT name claims was partially implemented (`staffContact`
uses `token.name` isolation) and will be extended to overrides when reliably deployable.

---

### Finding 2 — Firestore rules allow any authenticated account to alter any member's data
**Verdict: Known, documented trade-off.**

Per-member write isolation (`request.auth.token.name == memberName`) was implemented at
v10.72 and reverted at v10.94 after it caused a production outage when custom JWT claims
weren't reliably set. The revert, the cause, and the re-introduction checklist are all
documented in `KNOWN_LIMITATIONS.md` task #2. The `firestore.rules` file itself carries
a comment on lines 4–8 explaining the situation. The reviewer's description is accurate;
it is not new information.

---

### Finding 3 — Cultural calendar data readable by all authenticated users
**Verdict: Intentional design.**

`memberSettings` (`faithCalendar` field) carries `allow read: if request.auth != null`.
This is intentional: the shared team calendar displays all members' cultural calendar
markers, which requires reading all preferences. Staff set their own preference
voluntarily in Settings. The reviewer's GDPR concern is noted, but for a small internal
team where all members know each other and opt in themselves, this is an accepted design
decision. We acknowledge the trade-off.

---

### Finding 4 — Huddle files effectively public
**Verdict: Accurate; risk accepted given context.**

The `huddles` Firestore collection is open-read (no auth). This is documented in
`firestore.rules` with the rationale: `app.js` has no Firebase Auth session, so
requiring auth would break Huddle auto-open on fresh visits and notification taps.
The daily huddle contains operational information for a team of 28 people. The app URL
is not publicly advertised. We acknowledge this as a real finding and the risk is
accepted for now; it is a candidate for a future authenticated read path if the Huddle
viewer is ever moved to a page that already has a session.

---

### Finding 5 — GitHub Pages deployment doesn't receive Firebase security headers
**Verdict: Accurate, but platform-constrained — not fixable by configuration.**

`firebase.json` security headers (CSP, HSTS, X-Frame-Options etc.) only apply to
Firebase Hosting. GitHub Pages for user/org sites (`*.github.io`) has **no mechanism
to serve custom HTTP response headers** — there is no `_headers` file equivalent for
GitHub Pages. This is a genuine gap. The staff URL (`garethdavidmiller.github.io`) is
a secondary deployment whose primary purpose is availability resilience; the canonical
URL (`myb-roster.web.app`) receives full Firebase security headers. The long-term
resolution is to retire the GitHub Pages deployment and use Firebase Hosting as the
single URL, which is already noted in the roadmap.

---

### Finding 6 — `setupRosterAuth` doesn't re-enable returning accounts
**Verdict: Confirmed bug. Fixed in v13.15.**

When `createUser` throws `auth/email-already-exists`, the handler fetched the UID and
updated custom claims — but never called `updateUser({ disabled: false })`. A returning
staff member whose account had been disabled via the `removeOrphans` path would receive
correct claims but remain locked, causing silent login failure.

**Fix:** Added `updateUser({ disabled: false })` when the fetched existing account has
`disabled: true`. The fix is in `functions/index.js` and was deployed in v13.15.

---

### Finding 7 — Push subscription creation allows unauthenticated creation
**Verdict: Intentional design.**

`firestore.rules` line 121 carries a comment explaining this explicitly:

> *"Push subscriptions are written from index.html (public, no login required). The
> stored data is a browser endpoint URL and encryption keys — not PII."*

`index.html` deliberately has no Firebase Auth session (required for Huddle and override
reads to work on first visit). Push endpoint URLs are not sensitive — a malicious fake
subscription wastes a few bytes of Firestore storage. Shape validation prevents
malformed documents. This is a documented, intentional decision.

---

### Finding 8 — Roster parser accepts impossible dates (e.g. 2025-02-29)
**Verdict: Already fixed in v13.13.**

A strict round-trip calendar check was added in v13.13 (`functions/index.js` lines
149–155). JS's `Date` normalises invalid dates rather than returning `NaN`, so an
`isNaN` check alone is insufficient — the fix adds an explicit year/month/day comparison
against the parsed date's UTC components. The reviewer was assessing v13.12 or earlier.

---

### Finding 9 — Shift normalisation accepts impossible times (29:75-88:90)
**Verdict: Low-impact; admin-reviewed path.**

`normaliseShift` in `roster-parse-helpers.js` uses a regex that would pass through
`29:75-88:90` as a shift value. However, this function only runs on AI-parsed output in
the roster upload pipeline, and the result is shown in the admin review table for
explicit approval before anything is written to Firestore. A garbage time value would
be visible in the review table and caught manually. It is not a silent-corruption path.
We agree a bounds check would be a robustness improvement but it is not a defect given
the human review step.

---

### Finding 10 — SW cache deletion too broad
**Verdict: Not applicable to this deployment.**

The activate handler deletes all caches on the origin that don't match the current cache
name. The reviewer's concern is that this could delete other apps' caches on the same
origin. Both origins this app is deployed on (`myb-roster.web.app` and
`garethdavidmiller.github.io`) are dedicated solely to this app — there are no other
apps sharing these origins. The concern does not apply. We note this as a general SW
best-practice (filtering by `name.startsWith('myb-roster-')` would be more defensive)
but it has no practical impact here.

---

### Finding 11 — Functions deployment workflow can mask failed deploys
**Verdict: Mild, real concern; deliberately scoped workaround.**

The `grep -q "cleanup policy"` exit-0 exception in `deploy-functions.yml` was added to
handle a known Firebase CLI quirk where a successful deploy exits non-zero due to an
artifact retention policy warning. The gap: if a genuine failure message happened to
also contain "cleanup policy", the failure would be silently swallowed. We agree the
matching is imprecise. A more robust approach would assert both the absence of an error
indicator and the presence of a success indicator. This is low priority given how
specific the string is, but it is a valid observation.

---

### Finding 12 — Focus trap misses `<input>`, `<select>`, `<textarea>`
**Verdict: Confirmed code defect. Fixed in v13.15.**

`trapFocus` in `overlay.js` line 95 had the selector:
```
button, a[href], [tabindex]:not([tabindex="-1"])
```
This excluded native focusable form elements. No current lightbox contains form fields
so there was no live bug, but the implementation was incomplete and would have produced
a broken Tab trap for any future lightbox with a form.

**Fix:** Selector updated to include `input, select, textarea`. Fixed in `overlay.js`
v13.15.

---

### Finding 13 — Seven unlabelled form controls
**Verdict: Likely partially valid; accessibility audit queued.**

We have not audited every form control against this finding. Unlabelled controls are a
genuine accessibility defect. We will run an axe/WAVE scan to identify the specific
controls and address them.

---

### Finding 14 — Audit docs stale (reviewer says 8 moderate, counts 9)
**Verdict: Inaccurate — docs are current.**

`KNOWN_LIMITATIONS.md` documents 8 moderate-severity vulnerabilities in the `uuid < 11.1.1`
dependency chain via `firebase-admin`. This count was verified and updated in v13.13.
We are unable to reproduce the reviewer's count of 9. The docs are current.

---

## Changes made as a result of this review

| Version | File | Change |
|---------|------|--------|
| v13.15 | `functions/index.js` | Re-enable disabled accounts in `setupRosterAuth` |
| v13.15 | `overlay.js` | Add `input`, `select`, `textarea` to `trapFocus` selector |
