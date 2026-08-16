# MYB Roster — Product Roadmap

*Last updated: August 2026 — v21.40 · Updated every 0.10 version*

**What should we build next, why, and what has to be true before we do it?** That is the only
question this file answers. Everything that has already been built, removed, tried and reverted, or
audited and closed lives in **`ROADMAP_HISTORY.md`** — it is not gone, and several entries there are
the only record of why something was removed, but it is not roadmap.

Dated obligations — the work that has a deadline whether or not anyone plans it — live in
**`MAINTENANCE_CALENDAR.md`**. Implementation specs live in CLAUDE.md and `.claude/rules/*`.

> **Split at v19.97** (external review). This file was 924 lines, about two-thirds of it the past.
> The history moved out verbatim. If something below has become history, **move it — do not copy
> it**; two live copies of a plan is the drift that made the split necessary.

---

## How to read an entry

Every real item answers the same questions. Where an answer is "none" or "unknown", it says so —
that is information, not an omission.

| Field | Means |
|---|---|
| **Status** | Idea · Conditional · Planned · Committed · Blocked |
| **Why** | The user problem. If there isn't one, it is an Idea at best |
| **Trigger** | What has to happen before work starts. "Someone asks" is a valid trigger |
| **Blocker** | The missing fact, input or decision |
| **Owner** | Who can say yes. Often not the developer |
| **Success** | How we would know it worked |
| **Review** | A date. "No work before then" is the default |
| **Evidence** | For anything asserting a business, payroll or railway rule — see below |

### Evidence class — required on operational rules

Adopted after the v19.94 review, where the Links panel printed a hard limit in red on a sheet for an
assessing manager, sourced to a conversation. **Code can be mathematically perfect while its premise
is wrong**, and no amount of unit testing detects that.

| Class | Meaning |
|---|---|
| **A** | Authoritative external — legislation, ORR, RDG/RST, HMRC |
| **B** | Controlled internal — a current Chiltern policy, agreement or payroll circular |
| **C** | Owner-confirmed operational practice |
| **D** | Working assumption |

**Anything rendered to a manager as "must be met", or to staff as a rule they could be refused
travel or pay by, requires A or B.** C and D may inform a tool; they may not be printed as a
requirement. The 13-day Links limit would have been flagged as *hard limit → evidence C* and failed
this gate before it was coded, which is stronger than adding another test after the fact.
(`links-limits.test.mjs` and `links-analysis.test.mjs` now enforce the rendered half of this.)

---

## ⚖️ THE GOVERNANCE GATE — is this app officially sanctioned by Chiltern?

**Status:** Open · **Owner:** Gareth + Chiltern management · **Review:** no date set — and it should have one

This was one line under "Open decisions". It is in fact the largest single question in the roadmap,
because it decides whether several features below should exist **at all** — not how they should be
built. Until it is answered, the answer is assumed to be "informal staff utility".

**If MYB Roster remains an informal staff utility** — the position today — then it must not become
the authoritative system for annual-leave approval, payroll, mandatory safety decisions, or official
staffing approval. It may *assist* all of those. That is the current boundary, and it is why the
Links panel says "must be met" about a limit rather than approving a design, and why the pay
calculator is an estimator.

**If Chiltern adopts it formally**, then a body of work starts that is currently in nobody's plan: a
named system owner, business continuity if the owner is unavailable, the data controller/processor
position, a retention policy, access reviews, authorised sources for every business rule, a support
expectation, and change approval. Several of those are obligations rather than features.

**Practical consequence right now:** three items below are blocked on *governance*, not on
engineering. Recording that honestly is the point — "depends on approval workflows" made Formal AL
look like a technical dependency when it is not.

---

## NOW — committed, or actively being decided

### December 2026 Links proposals
**Status:** Committed · **Owner:** Gareth + Nathan/management · **Plan:** `LINKS_DEC2026_PLAN.md`

The tool is built. What remains is a **decision and meeting schedule**, not code: the Sunday
operating-window boundary, the business staffing requirement, a controlled source for the company
hard limits, and a management review date. The readiness dashboard at the top of that plan is
authoritative; it now carries latest-safe dates worked backwards from the timetable change.

### Track E — the authentication decision
**Status:** Blocked on an owner decision · **Owner:** Gareth · **Design:** `AUTH_PLAN.md` · **Status of record:** `SECURITY_RELEASE_PLAN.md`

E0 and E1 have shipped; **E2 is the first phase that changes what is actually protected.** The
decision is the security/privacy bar, and it should be taken with the E3 measurement criteria
**pre-registered** — AUTH_PLAN §6 now requires the thresholds to be written down before telemetry
starts, precisely so they cannot be chosen after seeing the numbers.

This gates more than itself: **C5 cannot complete without it**, because a member who only ever reads
the roster never signs in and is therefore never compelled to set a password.

### Track C5 — retire the surname default
**Status:** Blocked · **Owner:** Gareth · **Plan:** `PASSWORD_PLAN.md` · **Gate:** ≥90% migrated

Irreversible. Blocked on the migration percentage, which is in turn blocked on Track E (above).
Read both before assuming it is close.

### 2027/28 Pay Calculator rollover
**Status:** Planned · **Deadline:** 6 April 2027 · **Start:** February 2027 · See `MAINTENANCE_CALENDAR.md`

A hard external deadline, not a feature. It is in the maintenance calendar with a deliberate
two-month warning, because "must be done by April" reliably becomes "started in April".

---

## NEXT — likely, but a trigger is required

### Rangers & Rovers guide
**Status:** **SHIPPED; SOURCE-CHECKED PER PRODUCT v20.10; REBUILT MARYLEBONE-FIRST v20.37** — `RANGERS_ROVERS_PLAN.md` · **Owner:** Gareth · **Trigger:** settle the two source conflicts through Chiltern/retail guidance

The v20.37 rebuild changed what the page answers first — *is this valid FROM MARYLEBONE* — and moved the two conflicts from PRODUCT level to CLAIM level, so an unresolved secondary condition no longer makes a whole card read as doubtful. It also added a fourth evidence state, `unconfirmed`: an absence is not a milder conflict and may not wear the conflict's marker.

A fifth guide page, for the ranger and rover area passes staff have to accept or refuse at the
gateline. Shipped at v20.05 **entirely unverified** and marked so in three enforced places; the owner
then checked its products against the live National Rail pages (Aug 2026), and the governance changed
shape as a result.

**The interesting part is what checking revealed the page-wide banner could not say.** Eight products
read cleanly. Two came back with the *source contradicting itself* — and under one "Draft" banner
those are indistinguishable from the eight, which costs the reader exactly what the banner was for.
So `GUIDE_SOURCES.md` gained a **`Conflict`** class and the page a status per product:

| Status | Meaning |
|---|---|
| `✓ National Rail checked · Aug 2026` | read at source; the card states what the source states |
| `⚠ Source conflict · check retail system` | read at source, and the source will not settle it |
| `Draft · source not yet verified` | not yet read at source |

**A Conflict is not a stronger Draft.** Draft = nobody looked. Conflict = somebody did, and the
publisher contradicts itself — re-reading fixes the first and can never fix the second. They must
never share a marker, or a staff member is sent back to a page that has already been read.

**The two unresolved ones, neither resolvable by looking again:**

- **Shakespeare Explorer** — National Rail's own page permits break of journey in its description and
  forbids it in the detailed outward/return conditions. One page, two answers.
- **Thames Rover 7 Day** — the current 7-Day promotion lists Chiltern (with Banbury and Bicester
  Village); the older TR3/TR7 formal page says GWR only. **The duration is load-bearing**: the 3-Day
  promotion lists GWR only, so a card headed "Thames Rover" would carry the 7-Day finding onto a
  product the current source says is not ours.

Settling either needs Chiltern/retail guidance, not another read. **Never resolve a conflict by
picking the likelier reading** — both cases refuse somebody whichever way they are called.

**Also outstanding:** four product-page URLs (Chiltern Friends & Family, West Midlands Family Day
Ranger, and the two conflicting Thames pages). Those rows cite the parent/landing page and say so,
rather than carrying a URL pattern-guessed from the others — a fabricated citation in a source
register is the precise failure the register exists to prevent, and it would look more authoritative
than the honest gap.

**The egress request still stands, and is now about maintenance rather than launch.** The session's
policy denies `nationalrail.co.uk` and `chilternrailways.co.uk` (re-tested Aug 2026, still
`EGRESS_BLOCKED`), and the allowlist is environment config that cannot be changed from inside a
session. **Gareth: add `www.nationalrail.co.uk` and `support.chilternrailways.co.uk` to this
environment's network policy (claude.ai/code → environment settings). Name the SUBDOMAINS** — the
Chiltern content is on `support.`, the product pages on `www.`. With that open, review passes can
quote verbatim instead of depending on the owner re-checking by hand each time.

**Half two stays with Gareth whatever the egress policy says:** *is it valid on us, and between which
stations* is an operator fact the national pages do not answer.

**The one design decision worth knowing without reading the plan:** the guide leads with the products
that are **not** valid on Chiltern, and states plainly that it is **not an exhaustive national list** —
absence is out of scope, not invalidity. It carried an approximate national product count until
v20.10; that went, because pinning a changing figure dates the page and buys the reader nothing.

### Address migration campaign
**Status:** Planned, sequenced after the password work · **Owner:** Gareth · **Trigger:** password migration substantially complete

Staff do not generally know the app has two addresses (`myb-roster.web.app` and the
`garethdavidmiller.github.io/roster-app/` mirror), so moving them across needs a real campaign, not a
notice.

**Why AFTER the password plan, concretely.** The forced set-password overlay fires at next sign-in and
completes itself within 60 days (sessions cap at 60 days since v20.47). A new address is a NEW ORIGIN,
so `localStorage` — and therefore the session — does not come with it: everyone who moves is signed out and
must sign in again there. Migrate first and a member meets an unfamiliar URL, a forced sign-in, and a
mandatory password overlay in one go; that is the moment someone concludes the app is broken. Doing the
password work first means the only new thing about the new address is the address.

**Three things the campaign has to handle — all consequences of "new origin", none obvious:**
1. **Signed out on arrival.** The session is per-origin. Expect the campaign to be, in practice, "sign in
   again at the new address", so the copy should say so rather than let it be a surprise.
2. **Pay calculator figures do not follow.** Same cause (`localStorage` is per-origin), and the reason the
   "💾 Move Your Pay Data" card exists. The campaign must carry this; it is the only genuinely
   unrecoverable loss, because everything else lives in Firestore and follows the account.
3. **Notifications double up during the transition.** A push subscription is tied to the service-worker
   registration, so it is per-origin too — and `fanOutPush` sends to EVERY doc in `pushSubscriptions` with
   no per-member dedup (verified in `functions/index.js`). A member subscribed on both addresses therefore
   gets two notifications per Huddle until the old subscription is removed. Decide whether the campaign
   tells people to turn notifications off on the old install, or whether the duplicates are accepted for
   the transition window.

**And the hard part: an installed PWA will not move itself.** It keeps launching from its own
service-worker cache at its own origin, so migrating means delete-and-reinstall from the new address —
which is exactly the instruction people get wrong. The per-address counters (Operations → Usage) already
distinguish installed from browser-tab opens, so the size of that problem is measurable before the campaign
is written, not guessed at afterwards.

**Read the signal correctly:** the MIRROR count going DOWN, not web.app going up. People appear on the
new address the moment they visit, but have only *moved* when they stop appearing on the old one.

### Track D — App Check, monitor mode
**Status:** Deferred · **Owner:** Gareth · **Trigger:** owner decision · **Status of record:** `SECURITY_RELEASE_PLAN.md`

D1 is monitor-only and therefore low-risk: it characterises legitimate traffic before anything is
enforced. D2 (enforce) must not start until D1 has run long enough to know what normal looks like.

### "Fill this year from calendar" — bulk roster pre-fill (paycalc)
**Status:** Possible · **Owner:** Gareth · **Trigger:** owner go-ahead on the three open design questions

One tap runs the roster-assist pre-fill across **every paid-but-empty payslip of the viewed tax
year**, instead of visiting each period individually. The multiplier for everything shipped around
it: the HPP hours estimate, the back-pay accrual and the "This tax year so far" summary all sharpen
directly with filled periods, and the v18.42 "Not entered yet: 10 Apr, 8 May" lines name exactly what
one tap would fix.

**Guard rails (already decided):**
- **Never overwrites** a period the member has entered — only paid-but-empty periods are touched
  (the same paid/empty test the "Not entered yet" lists use).
- Fills follow the existing **conservatism policy** (v9.02): premium categories only
  (Sat/Sun/BH/Boxing/RDW from base roster + overrides) — no inferred ambiguous categories, no
  standard weekday hours.
- Filled values are **marked as roster-suggested** (gold), exactly like the single-period pre-fill,
  so the member can see and correct what was assumed; the result card's 📅 "Hours from calendar"
  provenance chip (v18.44) then discloses it on each affected payslip.

**Design questions to settle with the owner before building (deliberately not decided):**
1. **Where the button lives** — leaning: beside the "Not entered yet: …" lines (HPP card and/or
   the year-so-far block), since they name what it fixes; alternative: the roster-hint bar.
2. **Confirm or not** — leaning NO confirm (it can't overwrite anything) with a clear receipt
   afterwards ("Filled 2 payslips from your calendar: 10 Apr, 8 May"); the alternative is a
   preview-first flow, which fights the one-tap point.
3. Whether the fill needs Firestore overrides for HISTORIC months (the override cache may not span
   the whole year client-side — check `fetchOverridesForPeriod` coverage) or base-roster-only is
   acceptable for old periods.

**Effort:** medium — the per-period suggestion engine (`getRosterSuggestion` /
`fetchOverridesForPeriod`) already exists; the work is the loop, the receipt UI, and the tests.

### Dispatcher pay calculator support
**Status:** Blocked · **Owner:** Chiltern payroll (via Gareth) · **Evidence required:** class B

Add Dispatcher pay rates to `GRADES` in `paycalc-calc.js` so Dispatcher staff can use the calculator.
**Blocked on** confirmed Dispatcher hourly rate, contracted hours and pension contribution. **Do not
add placeholder rates** — the calculator must be accurate or it misleads staff about their pay.

> **Validating the back-pay accrual against the real 24 Oct 2025 payslip has MOVED** to
> `VALIDATION_REGISTER.md` (August 2026). It was never a feature: nothing gets built, a payslip gets read.
> Sitting here between a pre-fill feature and Dispatcher rate support, it read like work to schedule
> rather than a figure to confirm — which is exactly how validation debt goes unpaid.

---

## LATER — conditional; no work before the trigger

### Calendar export — WebCal subscription
**Status:** Conditional · **Trigger:** at least a few staff ask · **Effort:** small-to-medium (not "~1 day")

Staff subscribe to a URL; their phone calendar (Google, Apple, Outlook) polls it automatically and
shows shifts as events, kept up to date as overrides change.

**Why not a static .ics download:** a one-off export becomes stale the moment any override is
recorded, and re-importing creates duplicate events in most calendar apps. A static export of the
base cycle only avoids that but omits the things most worth having (RDW, AL, swaps). Considered and
rejected.

**The approach:** a Cloud Function returns a fresh `.ics` built from base roster + current Firestore
overrides for one member on every request. New override types appear without any change to the
subscription.

> **⚠️ SECURITY DESIGN — settle this before writing any code (revised v19.97, external review).**
> The earlier note said "a short-lived or HMAC-signed token". **A short-lived token is the wrong
> shape for WebCal.** Calendar clients poll the same URL unattended for months; when the token
> expires the calendar does not prompt anyone — it silently stops updating, which is worse than not
> having the feature, because the member keeps trusting a stale roster.
>
> A WebCal URL **is a bearer credential**, unavoidably: Apple/Google/Outlook are not going to
> perform a Firebase sign-in. Design for that rather than around it —
> `/calendar-feed/<opaque-random-token>.ics`, where the token is high-entropy, **not derived from
> the member name**, individually scoped, revocable and regeneratable, stored server-side as a
> **hash**, and rate-limited. A "Reset calendar link" control invalidates the previous one.
>
> The effort estimate moves with it: token lifecycle, revocation, `.ics` escaping, timezone/BST
> handling, override deletion, calendar-client compatibility, privacy and tests are the work — the
> feed generation is the easy part.

### Daily operations view
**Status:** Conditional · **Trigger:** supervisors say the week view is insufficient

A single-day column showing who is working, spare or on AL, with a cover-status summary. **Partially
addressed already:** Team Week View (v8.22) shows the whole team by week, and in practice that may be
enough — supervisors can see the full week at a glance and identify gaps. No new data needed.

### Dark mode (toggleable)
**Status:** Idea · **Trigger:** repeated staff request, or evidence of a real low-light usability problem · **Review:** January 2027 · **No work before the trigger**

**Why it would suit this user base specifically:** staff work early/late/night shifts and check the
roster at 04:30 in dim mess rooms, on platforms before dawn, or in bed the night before. It is an
ergonomic fit for the actual use context, not a trend.

**Why it is tractable here:** the canvas is already brand navy (half-way conceptually), and the
palette is **oklch**, so a dark theme is mostly inverting the lightness channel of the surface tokens
and nudging a few accents — far easier than with hex. The three-surface model (canvas → card →
sunken) maps cleanly onto dark.

**If it is ever built, a toggle is essential.** Do **not** ship it as a silent `prefers-color-scheme`
switch: ship it behind an explicit on/off (ideally on/off/auto) control in Settings, defaulting to
today's light theme, so nobody is surprised by a changed app. Today `shared.css` forces
`color-scheme: light`; that opt-out is what a dark theme would replace, gated behind the toggle.

**Effort/risk when scoped:** medium effort (every surface/text token needs a dark counterpart, AA
re-verified in both themes), low risk (additive, behind the toggle).

### Approval workflows (shift swaps)
**Status:** Conditional · **Trigger:** demonstrated request volume · **Also gated by:** the governance gate

**Overtime availability came out of this entry and shipped at v20.56** — as a DECLARATION rather than
a request, which is why it cleared the governance gate this entry is still waiting on. Nobody
approves or declines anything: staff state when they are free, a reviewer reads it, and the roster is
planned from it. No outcome is recorded against a person, so there is nothing for the company to
recognise or fail to recognise. Design: `OVERTIME_AVAILABILITY.md`.

What remains here is the genuinely approval-shaped case — **shift swaps**: staff submit a request, a
supervisor approves or declines, and the outcome is recorded. The current auth model is sufficient
for submitting; a supervisor UI would be needed.

**The real question is still whether the volume exists.** If swaps are currently handled by direct
conversation in small numbers, a formal workflow adds process without adding value. And the
governance gate bites here in a way it did not for availability: an approval the company does not
recognise is a worse outcome than no approval.

### Notifications for approval/assignment events
**Status:** Conditional · **Depends on:** approval workflows above

The push infrastructure exists; extending it to new event types is a small lift once there are
events to send. Any new type must follow `.claude/rules/notifications.md` — and use
`sendTargetedPush`, not `fanOutPush`, if it names or concerns one person.

### Native app
**Status:** Conditional · **Do not build speculatively.** The PWA works well for the current use case.

**Only pursue if one of these is true:**
- iOS push notification delivery is unacceptably unreliable in real use
- Chiltern IT require app store distribution via MDM
- PWA limitations are genuinely felt by users

**Technology choice is deliberately deferred** (revised v19.97, external review). This entry used to
say "React Native — only the UI layer needs rewriting", which is too confident for a decision that
may not be revisited for years, and understates the work: a native version also touches the
authentication lifecycle, notifications, deep links, offline state, local persistence, app updates,
distribution, MDM, platform permissions and possibly Firestore behaviour. **Re-evaluate React
Native, native platform development and the then-current alternatives if the trigger is ever
reached** — a 2026 implementation preference must not become a 2028 architectural requirement.
Distribution costs an Apple Developer account ($99/year) and Google Play ($25) whatever is chosen.

### Sign-in and Calendar start latency
**Status:** Phase 1 shipped (v21.29–30) · **Owner:** Gareth · **Plan:** `LATENCY_PLAN.md` · **Trigger:** one full month of start-ladder data

The measurement landed before the work, deliberately. Phases 2 (fetch the displayed month, not three
months of the whole team) and 3 (split Firebase Auth from Firestore) are both real, and which one is
worth doing is a question the App Speed card's "How far the start gets" block now answers. Read it
before starting either. The decision rule is a table in the plan.

### Build tooling — trigger-based; no action currently
**Status:** Conditional · **Do nothing until a trigger occurs**

Renamed from "Vite (not yet, but likely eventually)" at v19.97: "likely eventually" psychologically
turns a conditional into inevitable work, and the evidence below says the opposite.

**Current state:** no bundler or build step. Source files are served directly — what you write is
what loads. GitHub Actions deploys the source tree as-is.

**The constraint it would remove:** `roster-data.js` is a browser ES module; `functions/index.js` is
Node CommonJS, and the two cannot import from each other. That forces duplication of anything both
sides need — most visibly the roster name/role lists, though that specific risk is **managed** via
codegen (`functions/roster-members.json`, generated by `npm run generate:roster-members`, CI-locked
by `sw-asset-check.test.mjs`, so a missed generate step fails the build rather than the parse).

**Triggers — any one of:**
- the codegen/duplication pattern spreads (a second generated file, or a shared-logic duplicate
  beyond `normaliseSurname`) and drift starts slipping past the CI locks
- real TypeScript types are wanted (today `tsc --noEmit` runs over ~70 `// @ts-check` files — the
  checker without the emit)
- bundle size starts affecting load time on staff phones
- a bug is traced to drift in a hand-maintained preload/precache/duplication list

**If the time comes: Vite.** Minimal config, native ES modules, good Firebase/PWA plugin support,
output close to what you write today. The workflow change is `npm run build` before the Hosting
deploy, pointing at `dist/`. Cloud Functions stay separate.

**And the measurement that says "not yet":** the calendar is the slowest page, ~85% of loads
sub-second. Under 6× CPU throttle FCP moved only 272 → 360ms — eager JS execution is ~18ms, so the
cost is **fetching** the module graph, not parsing it. **Lazy-loading modules was measured and
rejected** — it reduces execution cost, and execution is not the bottleneck. Full figures:
`ROADMAP_HISTORY.md` → Performance. Do not re-propose without new evidence.

---

## DO NOT BUILD UNTIL — governance, not engineering

### Formal AL management as an approval system
**Blocked on:** explicit Chiltern agreement that MYB Roster is authorised to record official leave
decisions. **Not** on approval workflows.

Chiltern has an official HR system for leave. Building a parallel approval process risks conflict
between the two, and a member could reasonably believe leave was booked when it was not. The app's AL
booking is and must remain **informational** — a record of what you have taken, not a decision — until
that agreement exists. The old entry said "Depends on: Approval workflows (above)", which made this
look like a technical dependency waiting on a feature. It is a governance dependency waiting on a
conversation.

### Formal shift-swap approval
Same reasoning, same gate.

### The app as the authoritative source for payroll or mandatory safety decisions
The pay calculator is an **estimator** and says so. The Links hard-limit check reports against a
policy limit and does not approve a design. Both are correct as they stand for an informal utility;
both would need the governance gate answered before that changed.

---

## WATCH — no work, just monitoring

| Watch | Because | Where |
|---|---|---|
| Override document count | An archive strategy must land before ~5,000 docs | `MAINTENANCE_CALENDAR.md` |
| `firebase-admin` v14 | Blocked until `firebase-functions` widens its peer range; the scoped `uuid` override holds meanwhile. The originally-assumed v14 bump was neither needed nor safe | `KNOWN_LIMITATIONS.md`, `SECURITY_RELEASE_PLAN.md` → A1 |
| `npm audit --omit=dev` in `functions/` | The weekly workflow runs `--audit-level=high`, so low/moderate drift does **not** fail CI — it is caught only by looking | `SECURITY_RELEASE_PLAN.md` → A1 |
| App Speed card — the **Usable** milestone | Added v20.80, and the first figure that describes what a member actually waits for. The two older milestones cannot: "First appears" is the splash painting, and "Code loaded" fires while the Calendar can still be blank. Watch this one, not those | Operations → App Speed |
| App Speed card, calendar tail | The only trigger that would reopen the bundler or SDK-deferral question | This file → Build tooling |
| Per-address counters | The signal for the migration campaign — read the mirror going down | Operations → Usage |

---

## Decisions taken — recorded so they are not re-raised

- **Pay-data transfer notice — DISMISSED as drafted** (owner, 31 Jul 2026). A one-time notice
  pointing staff at the "💾 Move Your Pay Data" card was drafted and rejected in that form. **Do not
  simply re-raise it**: the deferral reason that used to sit here (the `password-2026` campaign) is
  gone, so "the blocker has cleared" is not a reason to write it. If it returns it needs a different
  shape, not a rescheduled one. Nobody loses pay data by there being no notice — the card exists with
  a working deep link (`paycalc.html#payTransferCard`), and figures are lost only by switching
  address and expecting them to follow. There is no deadline.
- **Admin task navigator — BUILT, THEN REMOVED** (owner, Aug 2026). A chip row under the member bar
  (Change a Shift · Annual leave · Absence · Saved changes) shipped at v21.38 and came out at v21.40:
  *"Feels like clutter."* It has since been re-recommended by an external review, so the decision is
  written down here rather than re-argued: **the owner has seen it working and does not want it.**
  The cost it was meant to remove is real and is accepted — a self-service member opening Admin
  scrolls past the whole Change-a-Shift card to reach Record Annual Leave, because the default card
  is Change a Shift for everyone (also an owner decision, v21.38). If that reach is ever reopened,
  the cheaper move is the auto-open that predates the row (see `applyPermissions` in `admin-app.js`),
  not a second navigation idiom — but it needs the owner to ask, not a reviewer to suggest.
  **The row left a hole behind it** (v21.43): with the chips gone the member bar's own 6px of
  padding and the container's 12px gap read as one 18px band of navy — the widest gap on the page,
  and reported as having "grown", though nothing about it had changed since v21.37. Removing a
  thing is not finished until the space it occupied is closed.
- **Profile photo / avatar — removed** at v12.22; the nav footer shows initials on a stable per-name
  colour. Full restoration spec: `ROADMAP_HISTORY.md`.
- **Cultural calendar — removed** at v13.23 (annual maintenance burden + GDPR Article 9 exposure +
  no observed usage). Full restoration spec and the erasure requirement: `ROADMAP_HISTORY.md`.
- **Password security — the original five-stage plan is superseded** by the "C-lite" design in
  `PASSWORD_PLAN.md`, which did not wait on email verification. The original staged text is kept in
  `ROADMAP_HISTORY.md` because its reasoning is still sound; do not plan from it.
- **GDPR:** staff shift data is personal data. If the governance gate is answered "official", data
  controller status and retention policies need documenting — see that gate.

---

## Where everything else lives

| Looking for | File |
|---|---|
| What shipped, what was removed, what was tried and reverted | `ROADMAP_HISTORY.md` |
| Dated obligations and their warning points | `MAINTENANCE_CALENDAR.md` |
| Current status of every security/auth track | `SECURITY_RELEASE_PLAN.md` — **the single source** |
| Password design and its implementation record | `PASSWORD_PLAN.md` |
| Full-app authentication design | `AUTH_PLAN.md` |
| December 2026 Links delivery | `LINKS_DEC2026_PLAN.md` |
| Active constraints and accepted limitations | `KNOWN_LIMITATIONS.md` |
| Backup, rollback and disaster recovery | `RECOVERY_RUNBOOK.md` |
| Implementation specs (schema, functions, auth) | `CLAUDE.md`, `AI_MAP.md`, `.claude/rules/*` |
