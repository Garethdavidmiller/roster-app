# MYB Roster — Product Roadmap

*Last updated: November 2026 — v25.90 · Updated every 0.10 version*

**What should we build next, why, and what has to be true before we do it?** That is the only
question this file answers. Everything that has already been built, removed, tried and reverted, or
audited and closed lives in **`ROADMAP_HISTORY.md`** — it is not gone, and several entries there are
the only record of why something was removed, but it is not roadmap.

Decisions that are already CLOSED — features declined, and choices recorded so they are not
re-argued — live in **`DECISIONS.md`**. Open decisions stay here, in `NOW`: "you need to decide X"
is roadmap, "we decided X" is not.

Dated obligations — the work that has a deadline whether or not anyone plans it — live in
**`MAINTENANCE_CALENDAR.md`**. Implementation specs live in CLAUDE.md and `.claude/rules/*`.

If something below has become history, **move it — do not copy it**; two live copies of a plan is
the drift that split this file twice. What moved is in `ROADMAP_HISTORY.md` (the past) and
`DECISIONS.md` (what was decided).

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

**Status:** Blocked on a Chiltern decision · **Owner:** Gareth + Chiltern management · **Review:** no date set — and it should have one

This was one line under "Open decisions". It is in fact the largest single question in the roadmap,
because it decides whether several features below should exist **at all** — not how they should be
built. Until it is answered, the answer is assumed to be "informal staff utility".

**If MYB Roster remains an informal staff utility** — the position today — then it must not become
the authoritative system for annual-leave approval, payroll, mandatory safety decisions, or official
staffing approval. It may *assist* all of those. That is the current boundary, and it is why the
Links panel reports a design against a limit rather than approving it, and why the pay calculator
is an estimator.

**If Chiltern adopts it formally**, then a body of work starts that is currently in nobody's plan: a
named system owner, business continuity if the owner is unavailable, the data controller/processor
position, a retention policy, access reviews, authorised sources for every business rule, a support
expectation, and change approval. Several of those are obligations rather than features.

**Practical consequence right now:** three items below are blocked on *governance*, not on
engineering. Recording that honestly is the point — "depends on approval workflows" made Formal AL
look like a technical dependency when it is not.

**And one item exists only on the far side of it.** If Chiltern adopts the app formally, the right
authentication end-state is **Microsoft / Entra ID work-account SSO** — the company then owns
joiners, leavers, password and MFA policy, account disablement and identity verification, and the
app consumes an identity and maps it to its own roles, which it already does cleanly via claims.
That is a better end-state than maintaining a staff authentication system indefinitely, and it
would supersede most of `CREDENTIAL_LIFECYCLE.md`. It is not a plan and needs no work: it depends
entirely on Chiltern IT registering the application, which is this gate. Recorded so that nobody
builds toward it, and so that nobody is surprised later that the custom work was the right call
*until* the gate moved.

---

## NOW — committed, or actively being decided

### The new CEA link — from January 2027
**Status:** Committed · **Owner:** S. Silva, the RMT rep, who leads the change (owner, 4 Nov 2026) · **Plan:** `LINKS_DEC2026_PLAN.md`

**The link starts in January 2027, not with the timetable** (owner, 2 Nov 2026: the timetable changes on 13 December,
the link follows, and today's link carries on until then; 8 Nov 2026: the day is not yet known). It is for everyone on the
normal CEA contract; those on a CEA bilingual contract keep their own links (owner, 8 Nov 2026). It is 26 weeks with five cover weeks
(`docs/links-26/RULES.md`), and the shortlist is three — **Balanced V6**, **Level Crossing** and **Middle Ground**, A to
Z, with no recommendation (owner, 8 Nov 2026, drawn for no two closing weeks side by side) — built into the Links designer read-only (`links-proposals.js`) and drawn
in the pack (`docs/links-26/`). The new link page (`newlink.html`) presents them evenly to everyone on the normal CEA
contract and the managers — **open since v25.60** (owner, 9 Nov 2026).

What remains is a decision, not code — S. Silva's, as the one leading the change, and then the area manager's review (the plan's dashboard) — and a controlled source for the company hard
limits. The readiness dashboard at the top of the plan is authoritative.

### Roster import — let the PDF's own grid decide the day
**Status:** Committed — phases 1 and 2 shipped, phase 3 not started · **Owner:** Gareth · **Proof:** `experiments/roster-pdf-geometry/` · **Code:** `functions/roster-geometry.js`, `functions/roster-prompt.js` · **Contract:** `.claude/rules/roster-import.md`

The import's model-side day-drift defences share one weakness: the row read, `sundayScan` and
`columnScan` all come from ONE model call looking at ONE PDF, so when the model collapses a blank
Sunday cell, every cross-check agrees with the wrong answer. The circuit breaker beside them
compares against the member's own base roster — the one witness the PDF cannot influence — but that
witness is deliberately WEAK, because a published roster legitimately carries leave, absence,
overtime and swaps on top of the rotation. **The strong witness is in the file**: the table's
vertical rules are DRAWN, at nine fixed x positions repeated on every content page, so assigning
each text run by coordinate places every cell. Three phases, in this order:

1. **A geometry WITNESS beside the AI result — shipped.** An AI day the physical cell cannot support
   is **refused, not weighed**: deterministic, with no probabilistic reasoning, no second opinion and
   no base-roster comparison. It runs in `parseRosterPDF` as the final gate, fails open everywhere,
   and the review states when it could not run (`geometryCopy` in `roster-alignment.js`). A full
   row offers nothing for a shifted claim to contradict, which is why phase 2 exists.
2. **Geometry assigns the days — shipped.** When the grid can place every member the roster type
   covers, the cells are extracted by coordinate and the model is handed them already separated, so
   Monday can no longer become Sunday: nothing is left for it to decide. One miss falls the whole
   document back to the PDF path, so a member legitimately absent from a week's sheet turns phase 2
   off for that upload; the coordinator logs which path it took and why.
3. **Deterministic parsing first, model as fallback** for the genuinely unusual cell — **not
   started.** Measured over three real rosters (week ending 26 Sep 2026), **291 of 297 non-empty
   cells are read by `normaliseShift` alone** once the duty-code line is dropped. What is left is
   `PIDD TRG` ×4 (not in the prompt's vocabulary; it reads as UNKNOWN), and `Until 10:30` and
   `Medical`, which genuinely want a person. `NA` and `NS` read as rest days on every day (owner,
   6 Nov 2026), so neither needs the model. Phase 3 would make that share PROVABLE rather than
   probable — a deterministic parser is testable in a way a model call is not, which is what would
   finally close the "we cannot show the model normalises well" caveat phase 2 ships with.

**The dependency decision is the owner's to reverse.** `pdfjs-dist` (pinned `6.5.438` since v25.91; the
experiment established the v4 line) is a dependency of `functions/` — server-side, so the no-bundler rule
does not bear on it, but "a few vetted libraries" is a discuss-first rule and this is the fourth.
Declining it costs one line: with the package absent the adapter returns `pdfjs-unavailable` and the
import behaves as it did before the witness. An archive from before a system change, or a scanned
sheet with no text layer, reads as "no grid" and the witness stands aside, which is the right
failure. What the PDF path still cannot see: `KNOWN_LIMITATIONS.md` → Roster data. How each phase
shipped, including the wiring defects found on the way: `ROADMAP_HISTORY.md`.

### Track E — the authentication decision
**Status:** Blocked on an owner decision · **Owner:** Gareth · **Design:** `AUTH_PLAN.md` · **Status of record:** `SECURITY_RELEASE_PLAN.md`

E0 and E1 have shipped. **E2 was SUPERSEDED, not built** — the staff PIN did its job, and
`SECURITY_RELEASE_PLAN.md` → Track E says "do not build it". The decision is the security/privacy
bar, and it should be taken with the E3 measurement criteria **pre-registered** — AUTH_PLAN §6
requires the thresholds to be written down before telemetry starts, precisely so they cannot be
chosen after seeing the numbers.

This gates more than itself: **C5 cannot complete without it**, because a member who only ever reads
the roster never signs in and is therefore never compelled to set a password.

### Calendar start — how often we deploy (OWNER DECISION, not a code change)
**Status:** Blocked on an owner decision — an external review's recommendation, not yet adopted · **Owner:** Gareth · **Would change:** release cadence, nothing in the tree

**The review's top-ranked item, and the only one that costs nothing.** It observed that this app
shipped many small releases in a short period and that each one puts installed devices through an
update: a new versioned cache, a warm-up, and a `controllerchange` reload. A colleague opening the
Calendar just after a release boots twice and calls it "the roster takes ages"; they have no way to
know they crossed a deployment.

**The measured cadence:** 62 releases in the fourteen days to 5 Sep 2026, 17 on the busiest day.
`registration.update()` runs hourly AND on every `visibilitychange` back to visible, so foregrounding
the app is itself an update check. At that rate a reload is a regular event rather than a rare one.

**What has already been done about the IMPACT rather than the cadence.** The reload is held until
the page is hidden, so a release no longer takes the Calendar away mid-read, and `readyUpdate` times
the wait a member then has, from coming back to the page until it is usable.

**What has NOT been decided, which is the review's actual point:** whether to batch releases so
installed devices spend most opens in the warm steady state — develop freely, ship one stable
release every few days rather than several a day. It needs no code and no security trade, so it is
recorded here rather than built. **Read "After a release" on the App Speed card first**
(`readyUpdate`): it sizes what a release costs the member who meets one. It has given no share of
opens since v24.98 (`perf-stats.js` says why); the last share, about one Calendar open in seven
(September 2026), was an undercount (`LATENCY.md` → THE CARD WAS TRIMMED).

### Track C5 — retire the surname default
**Status:** Blocked · **Owner:** Gareth · **Plan:** `PASSWORD_DESIGN.md` · **Gate:** ≥90% migrated

Irreversible. Blocked on the migration percentage, which is in turn blocked on Track E (above).
Read both before assuming it is close. **A second route is on the table and not adopted:** C6's
one-time codes would let the remaining surname credentials be replaced server-side with unknown
random ones, answering the credential question without touching the read one
(`CREDENTIAL_LIFECYCLE.md` §7; `SECURITY_RELEASE_PLAN.md` → Track C).

### 2027/28 Pay Calculator rollover
**Status:** Planned · **Deadline:** 6 April 2027 · **Start:** February 2027 · See `MAINTENANCE_CALENDAR.md`

A hard external deadline, not a feature. It is in the maintenance calendar with a deliberate
two-month warning, because "must be done by April" reliably becomes "started in April".

---

### Trains page — what comes after the preview
**Status:** Idea (each part) · **Owner:** Gareth · **Trigger:** each part names its own, below ·
**Blocker:** the open questions at the end · **Review:** before 13 Dec 2026, and again in January

`trains.html` is every member's (owner, 20 Oct 2026; DECISIONS.md), and the station PIN reads it
too: station-first, with ranked changes in a colleague's words, a card per station, the basic hour
as a stopping-pattern grid, and both timetables from Chiltern's published books, every stop
included. The ideas below were proposed with the preview (7 Oct 2026) and deliberately not built
yet; those since built are in ROADMAP_HISTORY.md → "Trains page — preview items shipped". They are
recorded so the page grows toward a plan rather than by accretion.

**A. Before 13 December — teaching the change.** Ready to pick up, in whatever order the owner
chooses (the trigger, the page opening to staff, was met on 20 Oct 2026).
- **What to say to customers** — one ready line per change, in the app's calm voice.
- **A change of the week** through App Notices, easy to paste into the Daily Huddle — one a week
  until the launch.
- **A short self-check** — five questions with the answer shown at once ("From 13 December, what is
  the last Saturday train to Birmingham?"). Nothing recorded, so it is practice, not a test.
- **A printable A4 sheet** from the same data, for the mess room and the ticket office.
- **Longer and shorter trains** — where a train loses coaches is where crowding complaints come
  from. Needs train lengths, which are not published to passengers: see the open questions.

**B. On and after 13 December — the at-a-glance page.** **Trigger:** the timetable starts.
- **Next out, at the front of the page** — today's day type and the next six departures with a
  countdown ("in 4 min"), full destination name, and (if the owner agrees to publish them) train
  length and planned platform, with the change material retired to a tab. Works offline, so it is
  useful on the gateline away from the boards. The page already changes over by itself: from 13
  December it says "What changed" and "Until 12 Dec", and the lookup answers from the running
  timetable (`timetablePhase` in `trains-change.js`); once the festive changes end it opens on
  Stations, on the station the device looked at last.
- **The basic-hour clock** — a clock face with a dot at each repeating minute (:02 Birmingham, :06
  Oxford…) and a hand at the current minute. Tap a dot for that train.
- **Where to?** — one button per destination: the next three trains, the minutes it usually leaves
  at, and first and last today. With calling points (December's are in), "also stops at…".
- **Last trains tonight** — the page has a Last trains card; what remains is the evening move
  to the top (from about 20:00) with a countdown to each last train, the after-midnight ones labelled "tonight, just after midnight".
- **Your shift** — for a signed-in member the Calendar already knows today's shift, so: "You're on
  15:45–23:55. Busiest spell 17:00–18:59. Last trains you'll see: …". No other tool can say this.
  It needs a sign-in: it is a member's own roster, and the station PIN is nobody (DECISIONS.md;
  AUTH_AND_SESSIONS.md invariant 24).
- **Busy times strip** — a 24-hour bar shaded by trains per hour with a "now" marker, reusing the
  departure curve the Links work already holds (`links-demand.js`).
- **Platform view for the next hour** — which train sits where, and which are joined. Needs the
  internal platform and join data, so it is the furthest out.

**What the page must get right whatever is built.**
- **It knows its dates** — a preview before 13 December, and it says it has ended at the May 2027
  change rather than quietly show old times (`timetablePhase`, `DEC_VALID_UNTIL`; the dates are
  in `MAINTENANCE_CALENDAR.md`).
- **Christmas and bank holidays differ** — special timetables over Christmas and New Year and on
  bank holidays. The page should say so, not show the normal pattern. Chiltern's December books say
  nothing about Christmas or bank holidays (checked 20 Oct 2026). For Christmas the page does say so:
  Chiltern's timetable page states more changes between 13 December and 10 January, "including
  significant changes over the Christmas and New Year period", and the overview names that window
  until it ends (`FURTHER_CHANGES_UNTIL`). **Still open:** the actual festive times, which will have
  to come from Chiltern's Christmas publicity — no 2026 detail was published when checked, and last
  year's pattern is not evidence for this one — and the bank holidays inside the books' validity
  (Good Friday, Easter Monday, the early-May holiday).
- **Publish only what a passenger timetable prints.** The repository and the Pages mirror are
  public. Lengths, platforms, joins, diagrams and empty-stock moves stay out unless the owner
  decides otherwise (below). `docs/timetable-dec26/tooling/build.py` enforces this today.
- **One generated data file.** A revised simplifier is a re-run of the tooling and a test, never a
  hand edit (README beside the tooling).

**Open questions for the owner.**
- Its place in the drawer — second after Calendar was the suggestion. Today it sits after Pay and
  before Settings.
- Are train lengths and planned platforms fine to publish? They make Next out and the crowding
  list useful, and they are internal planning detail rather than a passenger fact.
- What "5 (3)" means in the simplifier's coaches column.

## NEXT — likely, but a trigger is required

### Overtime full launch — the three things the beta must answer first
**Status:** Blocked on the launch decision — Overtime is PAUSED, closed to everyone, the admin included (`OVERTIME_AVAILABILITY.md` → Paused) · **Owner:** Gareth (the launch decision) · **Trigger:** each item names its own, below

The feature ran as a restricted beta (`CONFIG.OVERTIME_BETA` + the reviewers; the beta list has been
empty since 7 Oct 2026) until it was paused, and the design record is `OVERTIME_AVAILABILITY.md`. Three items were flagged in the Aug 2026 external review of
v21.53 as *pre-full-launch* considerations rather than defects — recorded here so the launch
decision is made against them rather than rediscovering them:

- **Revision-2+ history reads off the Manager's first render.** The revision read is already
  skipped for anyone at revision 1 (most people, most weeks), but every reviser still costs a
  subcollection read that is awaited before the workspace paints. **Trigger:** a measured slow
  Manager load with real full-team data — not the theory. The shape if it fires: render current
  availability from the heads first, enrich the change/freshness markers afterwards.
- **Retry on a failed reminder send.** `reminderSentAt` is CLAIMED before the send, so a transient
  push failure gets no automatic second try: the scheduler is eligible only in the 24 hours before
  the initial deadline. What each attempt reached is recorded beside the claim
  (`reminderOutstanding`, `reminderAccepted`), and the reviewer's week card states it, so a broken
  push setup no longer reads as everyone reminded. Fine during a beta the admin is watching; at full
  launch, if reminders become operationally relied on, run the check more than once on the deadline
  morning. **Trigger:** full launch, if reminders matter operationally by then.
- **A second reminder before the FINAL deadline — a decision, not a feature.** Today the only
  reminder is on the initial deadline's morning. If the beta shows people missing the initial
  Tuesday and *still* not submitting despite the extra week, a final-Monday reminder is justified;
  if not, fewer notifications is better and the answer is no. **Trigger:** observed repeat
  non-response in real beta weeks.

### Address migration campaign
**Status:** Planned, sequenced after the password work · **Owner:** Gareth · **Trigger:** password migration substantially complete

Staff do not generally know the app has two addresses (`myb-roster.web.app` and the
`garethdavidmiller.github.io/roster-app/` mirror), so moving them across needs a real campaign, not a
notice. (One notice has gone out all the same: `install-app-2026` asks phone users on the mirror to
install from `myb-roster.web.app` and to move their Pay data first. The campaign is still the
rest.)

**Why it is worth doing.** It is the one change with two payoffs: fewer bytes on every cold load
(`KNOWN_LIMITATIONS.md` → the Pages mirror's 21%), and headers and redirects reaching the staff who
today get neither — most of them, since the mirror is where most staff open the app. The cost is
operational, not technical: telling colleagues, and reinstalling from the canonical URL.

**Why AFTER the password plan, concretely.** The forced set-password overlay fires at next sign-in and
completes itself within 60 days (sessions last 60 days). A new address is a NEW ORIGIN,
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
   no per-member dedup (verified in `functions/push.js`). A member subscribed on both addresses therefore
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

### Links generator — Recommended settings, with the five objectives behind Advanced

**Raised twice by external review.** Nothing here is a defect: the card works, and the objectives
are correctly implemented and tested (`links-adjacency.js`). The problem is the order it asks
things in.

The generator card opens with all five optimisation switches — *Vary the shift type · Most shifts in
a row · Gentle week-to-week change · Full weekends off · Long weekends* (a sixth, *Rest across the
week boundary*, became a fixed rule: minimum rest is a gate, not a preference). A designer therefore has to understand the optimisation engine before they have built
anything, which is the wrong way round: the first design is the one that teaches them what the
objectives are for.

The proposed shape, unchanged from the review:

> **How should the weeks be arranged?**
> **Recommended settings ✓** — Balances shift variety, consecutive working days and useful rest.
> **Advanced settings ▾** — today's five controls, collapsed.

**The algorithms do not change.** This is disclosure order, and it is the app's own documented rule
applied to a card that predates it: progressive disclosure may hide the fourth thing a surface owes
a member (deep dive) and may never hide the first (that the thing exists). "Recommended settings"
names what is happening; the five switches are depth.

**The trigger is the owner.** It is a visible change to the card a designer uses most, the new
link's proposals are judged against its checks (drawn by the `docs/links-26/tooling` scripts
running the Links modules under Node, or supplied as grids and imported — not in this card), and two
of this app's collapse decisions have been reverted after shipping (the admin task navigator, the
drawer's notification row). It wants a
decision, not a sweep. If it goes ahead, `links-tips.js`'s "The default table" section and the
generator card's one `.links-desc` sentence move with it — the desktop left-edge e2e check counts
that sentence.

**A second, smaller item travels with it:** the generator's target table loses its day context on a
narrow screen — Mon–Fri / Sat / Sun are column headers, and a long table scrolls them out of sight.
This is NOT the compare-grid case already declined (DECISIONS.md): that grid is two designs side by side and its
cells are self-describing once the columns are in step, whereas here a designer is typing numbers
into a cell whose meaning is off-screen. Worth solving with a sticky header row rather than
per-cell labels — **but note what that costs, because the obvious version cannot work**: below
768px the wrapper sets `overflow-x: auto`, and per spec the other axis then computes to `auto`
too, so the wrapper is a vertical scroll container as tall as its own content and `position:
sticky` sticks to a box that never scrolls. The declaration is already there and already inert
(KNOWN_LIMITATIONS records it; `e2e/links.spec.js` pins both states). Making it stick needs a
`max-height` and a NESTED SCROLLBOX around the primary creation path — which is precisely what
the review said it would rather avoid. So the two candidate remedies are a nested scrollbox or
per-cell labels, and the owner is choosing between them, not approving the cheaper-sounding one.

### Track D — App Check, monitor mode
**Status:** Blocked on an owner decision — deferred, not closed · **Owner:** Gareth · **Status of record:** `SECURITY_RELEASE_PLAN.md`

D1 is monitor-only and therefore low-risk: it characterises legitimate traffic before anything is
enforced. D2 (enforce) must not start until D1 has run long enough to know what normal looks like.

### Dispatcher pay calculator support
**Status:** Blocked · **Owner:** Chiltern payroll (via Gareth) · **Evidence required:** class B

Add Dispatcher pay rates to `GRADES` in `paycalc-calc.js`, and let `gradeForRole` (`roster-data.js`)
return a grade for a Dispatcher — it refuses one today — so Dispatcher staff can use the calculator.
**Blocked on** confirmed Dispatcher hourly rate, contracted hours and pension contribution. **Do not
add placeholder rates** — the calculator must be accurate or it misleads staff about their pay.
Until then a Dispatcher who opens the calculator is told exactly that — not covered yet, and added once
Dispatcher rates are confirmed (`paycalc-role-card.js`, v25.50) — so the change that adds the rates
retires that card's Dispatcher wording in the same commit.

### Plain-English education pass — HPP, back pay, FIP cards and coupons
**Status:** Committed direction, the first subject shipped · **Owner:** Gareth · **Trigger:** the owner picks the
next subject · **Success:** a colleague who does not know the term can find, understand and use the
feature from the app alone, without asking anyone

**Why.** Colleagues report not understanding what HPP is, how back pay works, or how to use FIP cards
and coupons (owner, 3 Sep 2026). The app has the facts — a Pay Calculator that models both
entitlements, a FIP guide checked country by country — and still the people it is for cannot always
use them. That is an education problem, not a features problem, and it is the challenge this app
has to rise to better. The standard is written down in CLAUDE.md → *"Plain English that TEACHES"*.

**Shape, so the first pass does not become a rewrite.** Start where people already are, not in a
new page: the card header, the row hint, the `?` panel — *name → one sentence → where you see it
in the real world*. Check the "new member, nothing entered yet" cohort on every subject, because
prompts gated on stored data never reach them (the HPP banner is the worked example). Judge by
asking two colleagues to do the task from the app alone, never by page height or word count. Cut
decisions, not explanations.

**Subject 1 — Sunday vs Rest Day Working — has shipped** (`paycalc-copy-parity.test.mjs` pins the
distinction; the story is in `ROADMAP_HISTORY.md`), and it settled what the pass actually does:
**carry the fact to the point of use; do not write it again somewhere new.** The Pay Calculator
Guide already had the fact, stated perfectly, and it did not help, because a guide has to be OPENED
and the member was reading the form. **Next subjects, in order of evidence: HPP and back pay** (both
already carry the "nobody told me this exists" shape) — but wait for a real report rather than
picking one.

**Method, per surface.** Read it as a first-time colleague and answer: what terminology does this
screen assume · what important thing can only be found by somebody who already knows its name · what
is the collapsed/header copy teaching · is every acronym expanded on first meaningful use · does the
screen say what / why / what next · can the task be finished without opening a guide, and if a guide
is opened, can somebody with zero prior knowledge build the mental model there. Score **usability**
and **learnability** separately (CLAUDE.md → *"Plain English that TEACHES"*); they are different
numbers and this app needs both. Beyond the candidate subjects below, the surfaces worth that read are
Pay (HPP · back pay · Year to Date · pension · payslip line names), FIP (Card vs coupons vs operator
vs reservations), Railcards (the railcard's discount vs the ticket's validity vs what staff actually
do), Rangers & Rovers (valid at Marylebone vs valid elsewhere), Overtime (what submitting
availability does and does not commit you to), Admin (base roster vs recorded change) and Settings
(password, work email, install, notifications).

**Candidate next subjects**, for the owner to order: a FIP coupon (what one is, how you get one,
where it works and where it does not — the guide has the depth; the missing thing may be the
"start here" ladder above it); HPP (one sentence at the point where hours are entered, since the
premium is built from them); back pay (what "backdated to 1 April" means on the payslip it lands on).

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

> **⚠️ SECURITY DESIGN — settle this before writing any code.**
> **A short-lived token is the wrong
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
addressed already:** Team Week View shows the whole team by week, and in practice that may be
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
`color-scheme: only light`; that opt-out is what a dark theme would replace, gated behind the toggle.

**Effort/risk when scoped:** medium effort (every surface/text token needs a dark counterpart, AA
re-verified in both themes), low risk (additive, behind the toggle).

### Approval workflows (shift swaps)
**Status:** Conditional · **Trigger:** demonstrated request volume · **Also gated by:** the governance gate

**Overtime availability came out of this entry** — as a DECLARATION rather than
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

**Technology choice is deliberately deferred.** "Only the UI layer needs rewriting" is too confident
for a decision that may not be revisited for years, and understates the work: a native version also
touches the
authentication lifecycle, notifications, deep links, offline state, local persistence, app updates,
distribution, MDM, platform permissions and possibly Firestore behaviour. **Re-evaluate React
Native, native platform development and the then-current alternatives if the trigger is ever
reached** — a 2026 implementation preference must not become a 2028 architectural requirement.
Distribution costs an Apple Developer account ($99/year) and Google Play ($25) whatever is chosen.

### Split the three largest page controllers — each when it is next changed
**Status:** Conditional · **Trigger:** the next change to that page · **Owner:** the developer · **Review:** at that change, not before

**Why:** an external review (10 Nov 2026) named `links-app.js`, `admin-app.js` and `paycalc-app.js`
(2,657, 1,729 and 1,597 lines when it measured them) as the files where one edit is hardest to
review. Each mixes the page's wiring, its drawing and its rules, so a change to one part is read
beside all the rest, and a rule can only be tested by standing the whole page up.

**Why not now:** moving working code with no change behind it puts risk on staff for nothing they
would see, and the browser suite proves what a page does, not how its code is arranged. A split is
safest made inside a change that needs it, and tested by it. The reviewer advised the same.

**How:** the pattern is already in the repo. The rules move to a pure module tested in Node, and the
page keeps the wiring (`pdf-viewer-core.js`, `calendar-access-core.js`, `paycalc-calc.js`). One
seam per change, not a rewrite; `FILE_INDEX.md` and `AI_MAP.md` change in the same commit (the
pre-commit hook enforces both).

**Success:** the touched file is smaller, what moved has Node tests of its own, and no browser test
had to change.

### Build tooling — trigger-based; no action currently
**Status:** Conditional · **Do nothing until a trigger occurs**

Not "likely eventually": that wording turns a conditional into inevitable work, and the evidence
below says the opposite.

**Current state:** no bundler or build step. Source files are served directly — what you write is
what loads. GitHub Actions deploys the source tree as-is.

**The constraint it would remove:** `roster-data.js` is a browser ES module; `functions/index.js` is
Node CommonJS, and the two cannot import from each other. That forces duplication of anything both
sides need — most visibly the roster name/role lists, though that specific risk is **managed** via
codegen (`functions/roster-members.json`, generated by `npm run generate:roster-members`, CI-locked
by `sw-asset-check.test.mjs`, so a missed generate step fails the build rather than the parse).

**Triggers — either of the two in `DECISIONS.md` → "No build step", which is the record:**
- real TypeScript types are wanted (today `tsc --noEmit` runs over nearly every root `// @ts-check` file — the
  checker without the emit)
- a bug is traced to drift in a hand-maintained preload/precache/duplication list — drift getting
  past the CI locks, which is also how a spreading codegen or duplication pattern would show

Load time on staff phones is measured and is deliberately **not** a trigger (the same entry says why).

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
| `npm audit --omit=dev` in `functions/` | The weekly `functions-audit.yml` fails only on a high or critical finding (`scripts/audit-functions-deps.sh`), and its root-tree job is report-only, so moderate drift does **not** fail CI — it is caught only by looking | `SECURITY_RELEASE_PLAN.md` → A1 |
| App Speed card — the **Usable** milestone | The first figure that describes what a member actually waits for. The two older milestones cannot: "First appears" is the splash painting, and "Code loaded" fires while the Calendar can still be blank. Watch this one, not those | Operations → App Speed |
| App Speed card, calendar tail | Load time on staff phones — an input to the build-step question, deliberately not a trigger (`DECISIONS.md` → "No build step"); `LATENCY.md` → Phase 3 holds the reading that would justify acting | This file → Build tooling |
| App Speed card — **Own roster** (`rosterSnapshot`) | Whether a returning member's open now SHOWS a roster well inside a second. The own-roster copy (`CALENDAR_DATA.md` 17) is the identity round trip's answer, and this milestone measures it directly; the decision record is `ROADMAP_HISTORY.md` and `DECISIONS.md` → "The own-roster copy" | Operations → App Speed |
| Per-address counters | The signal for the migration campaign — read the mirror going down | Operations → Usage |

---

## Where everything else lives

| Looking for | File |
|---|---|
| What shipped, what was removed, what was tried and reverted | `ROADMAP_HISTORY.md` |
| The v23.01 external review's index, and the print review (Sep 2026) — both closed | `ROADMAP_HISTORY.md` |
| Decisions already taken, and features declined | `DECISIONS.md` — **do not re-argue one without reading it** |
| Dated obligations and their warning points | `MAINTENANCE_CALENDAR.md` |
| Current status of every security/auth track | `SECURITY_RELEASE_PLAN.md` — **the single source** |
| Password design and its implementation record | `PASSWORD_DESIGN.md` |
| Full-app authentication design | `AUTH_PLAN.md` |
| The new CEA link, from January 2027 | `LINKS_DEC2026_PLAN.md` |
| Active constraints and accepted limitations | `KNOWN_LIMITATIONS.md` |
| Backup, rollback and disaster recovery | `RECOVERY_RUNBOOK.md` |
| Implementation specs (schema, functions, auth) | `docs/DATA_MODEL.md` (schema), `CLAUDE.md`, `AI_MAP.md`, `.claude/rules/*` |
