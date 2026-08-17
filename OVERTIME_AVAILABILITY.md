# Overtime Availability — feature design

*Not version-stamped; not a runtime asset. Shipped v20.56–v20.61.*

Staff declare, per day, when they are available for overtime in a future roster week. A reviewer
(Manager or Master Admin) reads the answers by day and plans cover from them.

**This is the authoritative contract for Overtime Availability.** Other documents link here rather than restating
participant, deadline, revision or retention rules — those rules exist in one place on purpose, and a second copy is
the defect, not the convenience.

This file holds only what no module header owns — the decisions that span client, server, rules and
release. Everything else is routed the usual way:

| What | Where |
|---|---|
| Every RULE — clock, milestones, phases, participant selection, schema, concurrency | `functions/overtime-core.js` (header + `overtime-core.test.mjs`) |
| The five endpoints (four HTTP + the daily scheduler), auth, transactions, batches | `functions/overtime.js` |
| Words, London time formatting, submit disposition, derived history | `overtime-format.js` |
| The page: access gate, tabs, planning horizon | `overtime-app.js` |
| The member's seven-day form | `overtime-form.js` · roster context: `overtime-roster.js` |
| The reviewer's by-day workspace | `overtime-manager.js` |
| Server calls, timeout budgets, corrected clock | `overtime-data.js` |
| Storage shape and read permissions | `firestore.rules` → `overtimeWindows` |

---

## Invariants

The short list, for someone about to change something. Each states WHAT must hold; the WHY is in the
module beside the code.

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **No response and not available are different answers.** No view may merge them, and an empty section still renders its heading — a hidden "No response" makes *nobody outstanding* look exactly like a section that failed to draw. | `overtime-manager.js` |
| 2 | **An unanswered day stays unanswered.** No default, no copy-last-week, no inferring from the roster. | `overtime-form.js` |
| 3 | **The client never refuses a submission near a deadline.** Inside the grace band it sends and lets the server decide — a client that refuses has denied somebody who was in time. | `overtime-format.js` (`submitDisposition`) |
| 4 | **A timed-out write goes into RECONCILIATION, never reported as failed.** Aborting stops us waiting; it does not stop the server writing. `clientMutationId` is generated in one place so no call site can forget it. | `overtime-form.js` · `overtime-data.js` |
| 5 | **The participant snapshot is frozen at creation.** Its one exception is a leaver: a flag, never a delete, refused on a closed week, and removing the flag rather than writing `withdrawn: false` — because `where('withdrawn','==',true)` never matches a missing field. | `functions/overtime.js` (`withdrawOvertimeParticipant`) |
| 6 | **Identity is always `decoded.name`, never the request body.** | `functions/overtime.js` |
| 7 | **Deadlines are stored, never recomputed.** A window keeps the timetable it ran under; `policyVersion` records which. | `functions/overtime-core.js` |
| 8 | **`initialRevision` and `lateInitial` are derived, never stored.** A stored summary is a second answer that can disagree with the history it summarises — and it exists twice, so it may not drift. | `overtime-format.js` · `overtime-parity.test.mjs` |
| 9 | **Retention is filtered in the endpoints, not in the rules.** Rules are not filters: a `resource.data` condition fails the whole query rather than dropping a row, so one expired document would blank a reviewer's workspace. | `functions/overtime.js` |
| 10 | **The purge deletes bottom-up, parent LAST.** Firestore does not cascade, and a parent deleted alone orphans its tree permanently. | `functions/overtime.js` (`purgeExpiredOvertimeWindows`) |
| 11 | **Never name an internal document in staff-facing copy.** "The draft roster" is the roster office's artefact; to staff "the roster" is the one released on the Thursday. Reviewer surfaces may name it freely. | `overtime-format.js` |
| 12 | **A withdrawn member is withdrawn on BOTH sides.** `getMyOvertimeState` omits the window and `submitOvertimeAvailability` refuses with its own code (`withdrawn`, distinct from `not-a-participant` — one was never asked, the other was and has been stood down). Hiding the window is the courtesy; refusing the write is the half that matters, because a page opened before the withdrawal still has the form and the button. | `functions/overtime.js` |
| 13 | **Creation is conditional; the daily top-up is not.** "Nothing due" is the NORMAL state — the horizon is pre-created — so an early return on it would run the top-up only on the one day a week a new week enters the horizon, and a member invited on any other day would have no form on any already-open week until then. | `functions/overtime.js` (`autoCreateOvertimeWindows`) |

Reviewing is not participating — that one is an authorisation rule and lives in
`AUTH_AND_SESSIONS.md` invariant 14, with the rest of the claim model.

---

## The one catastrophic failure, and the thing that guards it

A weekly-window system fails silently before any document exists: **nobody creates the window.** Then
there are no participants, so nobody is outstanding, so no reminder can fire, and staff see nothing
at all. "No window" is indistinguishable from "no overtime needed this week", and a clerk plans a
roster from a page that is quietly empty.

The planning horizon is the answer. `getOvertimeManagerOverview` computes its week rows **from the
calendar**, not from Firestore, then marks which of them have windows — so a missing week is a row
that says `Not created` rather than a row that is absent. A missed week keeps its row until its
Saturday has passed, and the card's collapsed chip counts what is *missing* ("2 without a form"),
never what exists.

Anything that makes those rows less prominent makes the feature less safe.

## The member surface's wording grammar (v20.84)

A wording sweep after the owner reported the area "messy and inconsistent" — which, inventoried,
was four faults with one rule each. Keep to these when adding copy:

1. **A week is named once per surface.** The heading names it ("Week ending Saturday 29 August
   2026"); the span beneath locates it ("Sun 23 – Sat 29 Aug"). Never label the span "Roster
   week …" — that restates the heading it sits under.
2. **One verb for the boundary: a form CLOSES.** Open forms say "Closes <deadline>", closed ones
   "Closed <deadline>". The same instant had been "Changes close", "Closed — the final deadline
   was", "Closes" and "Answers due" on one page; only the reviewer's horizon keeps "Answers due"
   for the FIRST deadline, because it genuinely is a different boundary.
3. **Every green pill completes "Available …"** — All day · Before 07:00 · After 15:00 · Before &
   after duty · Custom times — and "Not available" stands apart as the charcoal answer. (The list
   shrank twice after this rule was written: the `all_day` duplicate on worked days at v21.22, and
   the 12-hour pill at v21.24 when willingness became its own tick. The RULE is unchanged.) The recorded CHIP keeps the full form ("Available all day"): chips stand alone on the
   reviewer's list; buttons sit in a radiogroup already labelled "Availability on <day>".
4. **Each fact is stated once, in one phrasing.** The BETA strip says the data is real, the card
   hint says who the form tells, the explainer says it books nothing — three sentences, three
   jobs, where they used to circle the same relationship. The privacy line uses the ? panel's
   exact phrasing ("Managers and the admin can see what you submit"), and the member's row states
   speak one voice: Submitted — you can still change it · Submitted — now final · Not submitted
   yet · Nothing was submitted.


### Two decisions the horizon encodes — settled, not inherited (owner, Aug 2026)

An external review asked that both be approved explicitly rather than acquired by implementation.
Both were, and they are recorded here so the next reader does not re-litigate them.

**Every roster week gets a form, automatically.** The daily scheduler creates the horizon; a Manager's
**Open now** is a recovery action, not the normal route. The choice this makes is that availability is
a *standing weekly process* rather than something requested when needed — which is what the roster
desk actually wants. The consequence to keep in view: there is deliberately no "no form required this
week" concept, so a week with no overtime need still asks and simply collects "not available". If that
ever becomes a nuisance, the answer is that concept, **not** switching the scheduler off — a week
nobody created is the one failure this whole design is built around.

**Three answerable weeks, not six.** Six was the original requirement and the code met it, but it had
somebody in mid-August declaring for a weekend in early October. A declaration that far out is much
likelier to change, so the reach cost response burden and data quality without buying planning value:
the draft and final cycles for a week finish well inside three weeks. `ANSWERABLE_WEEKS` in
`overtime-core.js` is the one number; `PLANNING_WEEKS` derives from it, and the "really answerable at
every hour" test follows the constant rather than being edited to agree with it.

---

## The weekly timetable

Every window is named by its **week-ending Saturday** (`YYYY-MM-DD`), which is also its document id —
so a duplicate window is impossible by construction rather than by a uniqueness check.

| Milestone | Offset from the Saturday | Kind |
|---|---|---|
| Week start (Sunday) | −6 days | calendar date |
| **Initial deadline** | −18 days, 12:00 London | instant |
| Draft roster published | −16 days | calendar date |
| **Final deadline** | −11 days, 12:00 London | instant |
| Final roster published | −9 days | calendar date |
| Retention expiry | +91 days, 00:00 London | instant |

Three phases follow from the two deadlines: `INITIAL_OPEN` → `FINAL_OPEN` → `CLOSED`. Both open
phases accept submissions and amendments; the distinction exists so the reviewer can see who
answered *after* the initial deadline (`lateInitial`) and who *changed* their answer after it
(`changedSinceInitial`).

**Deadlines are stored, never recomputed.** A window created under today's policy keeps the
timetable it ran under even if the offsets change later, and `policyVersion` is stamped beside them
so a future reader can tell which rules produced them. This is why `deriveMilestones` is called once,
at creation, and every later reader uses the stored values.

**Deadline arithmetic has no date library.** `londonTimestamp` derives the Europe/London offset with
`Intl.DateTimeFormat` + `formatToParts`, read back as if UTC. It is the highest-risk function in the
feature: one hour out either refuses somebody who was in time or accepts somebody who was late.
`overtime-core.test.mjs` pins it either side of both 2026 DST transitions.

---

## The audience is release policy, not an operational choice

`currentAudience()` in `functions/overtime.js` returns `'restricted'` and takes no input. A reviewer
**sees** which audience a window will have — the confirm bar states it and the expected participant
count — and cannot change it.

Widening the beta is a one-word edit there plus a deploy. A window's participant population is frozen
into its `participants` subcollection at creation and is **never rewritten** — including when a second
Create arrives for a week that already exists. A pilot rung slots in as a third value.

**But a frozen population may GROW while its week is still open** (v20.78), and it has to. The
original rule was "existing windows are untouched", which was correct in isolation and became wrong
the moment creation was automated: the scheduler keeps the whole horizon made in advance, so by the time
anybody is invited, every week they could usefully answer already exists. "Untouched" quietly meant
"an audience change never takes effect". It was reported live — a member added to the beta was told
"no forms are open for you" while the admin's were open, and her first form would have been a week
in October. At full launch the same arithmetic strands the entire roster for the length of the horizon.

The rule that resolves it without weakening the freeze: **you may join a window whose FIRST deadline
you can still meet.**

| Phase | May the population grow? | Why |
|---|---|---|
| `INITIAL_OPEN` (before the first deadline) | **Yes, add-only** | they can genuinely answer on time, so recording them as expected is true |
| `FINAL_OPEN` (between the two deadlines) | **Never** | they can still submit, but not on time — every judgement about them would be false (see below) |
| `CLOSED` / expired | **Never** | they could never have answered — adding them manufactures a permanent false non-responder, which is exactly what the freeze exists to prevent |

**The middle row is the correction, and it is worth stating why (v20.81, external review).** v20.78
gated this on "still open", which is one deadline too late. A window has two, and the FIRST is the
one every judgement is measured against: `deriveHistory` asks whether anything was accepted before
`initialDeadlineAt`. Add somebody after that and both answers about them are wrong in the same
direction — until they submit they sit under **No response** for a deadline that pre-dated their
invitation, and the moment they submit they are labelled **submitted after the initial deadline**.
Both read as a person who was asked and did not answer in time. They were never asked.

That is not a labelling bug a kinder word would fix; it is the data a clerk uses to decide who is
reliable. The alternative — stamp an `invitedAt` on the participant and teach every history rule to
measure from it — is a second set of late-submission semantics for a case that costs nothing to
avoid. A new participant simply starts from the next week whose first deadline is ahead of them,
which is a slightly later start in exchange for a record that stays true.

Nobody is ever REMOVED, at any phase. `addMissingParticipants` in `functions/overtime.js` is the one
implementation; it runs from two places, and both are tested because they arrive by different routes:
the nightly `autoCreateOvertimeWindows` (unattended, so an invitation takes effect without anyone
remembering) and the `existed` branch of `createOvertimeWindow` (which is what the reviewer's
**Add N** row action calls, for when you have just invited somebody and want to see it work).

The reviewer can SEE the gap because `getOvertimeManagerOverview` returns `canAdd` — **how many people
pressing "Add N" would actually add**. Without it the week looks complete, because everyone *in* it has
answered. It is `null` for a closed or final-phase week, so the row cannot offer an addition the server
would refuse.

**One number, computed server-side, deliberately (v21.15).** It used to send `audienceCount` (the size
of the current audience) and let the client subtract `expected` — and those count different
populations, because `expected` is net of withdrawals while `addMissingParticipants` compares the
audience against *every* participant document, withdrawn included. So one use of **Stop asking** gave
that week a permanent "Add 1": pressing it added nobody, reported "Nobody new to add", re-rendered and
offered it again, on every load until the week left `INITIAL_OPEN`. The withdrawal feature changed what
`expected` meant without changing what it was being compared against. Arithmetic that decides whether
to OFFER an action belongs beside the code that PERFORMS it.

The frozen snapshot is also the security model: participation *is* the authorisation. A member who
was not asked cannot submit, and there is no audience field to read at request time that could
disagree with who was actually invited.

`selectParticipants` fails **closed** — a misconfigured audience selects nobody, so
`createOvertimeWindow` refuses with `no-participants` and logs it rather than creating a window that
reads "0 of 0 received", which looks like a completed week.

---

## Identity, naming and the rename route

Every endpoint verifies the ID token with `checkRevoked: true` and takes the member from
`decoded.name` — the claim `setupRosterAuth` sets from the server-owned roster. **A body-supplied
member name is never read.** Master Admin has no override here either: oversight is not permission to
submit somebody else's declaration about their own life.

Documents are **keyed by member name**, matching `overrides` and every other collection in this app.
That makes a rename a data-migration event. The recovery route is the `uid` field: it is `null` at
creation and stamped onto the participant document on that member's first submission, so a renamed
member's historical documents can still be found by the identity that wrote them. Nothing reads it
today — it exists so that a rename is recoverable rather than archaeological.

The population comes from `functions/roster-members.json` (`overtimeRoster`, generated by
`npm run generate:roster-members` — never hand-edited, CI-locked). A new starter is therefore
invisible to this feature until that file is regenerated, exactly as they are to roster import.

**That file states who EXISTS, not who is asked** (v20.72). It lists every member with their
`hidden` and `managerOnly` flags; `selectParticipants` decides. Until v20.72 the generator was
called `overtimeEligibleMembers` and applied `!hidden && !managerOnly` at generation time — the same
rule, in a file that cannot express a second audience and that nobody would think to open when
asking who gets the form. Moving it changed no behaviour and made the rule answerable.

`selectParticipants` is deliberately **two stages**. Stage 1 is who could ever be asked — on this
week, still here, and **not a manager** — and it binds every audience, including ones not yet
written. Stage 2 is which of those this audience asks: `restricted` (today) the admin plus anyone
named in `CONFIG.OVERTIME_BETA`, `all` (the end state) everybody stage 1 allows.

The beta therefore widens **a name at a time, by invitation**, so a real member's experience can be
watched before every member has it. Stage 1 still binds those names: inviting a manager or a leaver
changes nothing, which is what stops the invitation list becoming a second, unreviewed route into a
population.

**Reaching the page is a separate question from reviewing it, and the first invited CEA is what
exposed that** (v20.76). The page had only ever had the reviewer answer — the nav pill was
reviewer-gated and `PAGE_POLICIES.overtime` demanded an `admin`/`manager` role — so a member the
server was already asking would have found no link in the drawer and a "not open to everyone yet"
panel if she typed the URL, with her form waiting on the server the whole time. `canOpenOvertime`
(reviewer **or** invited participant) now gates both; `isOvertimeReviewer` is untouched and still
decides who may see anybody else's declarations. **Do not merge the two predicates.** Widening the
reviewer test to make a pill appear is the one edit that turns a testing invitation into access to
colleagues' availability.

**Managers review; they never participate.** The right to see a week's answers comes from the
`manager` claim, not from the participant list, so a manager already sees everything without
appearing in any window. Putting one in adds no access and does add a record that they were
expected to answer — and because the snapshot is frozen, they read as a non-responder for that week
permanently, with no way to correct it. That is why the exclusion is stage 1 rather than a clause
in each branch: the restricted branch selects by ENTITLEMENT, so a manager who also held the admin
entitlement would otherwise slip through.

---

## Overnight duties — the one roster shape the anchored offers cannot describe

Dispatchers are the only grade rostered across midnight (22:00–07:00, 22:30–09:00, and late turns
ending past 00:00). On such a day the duty's `end` is the **next** calendar morning, and two of the
roster-anchored offers are wrong there in different ways: "After {end}" stores a boundary on the
wrong day (hours the member never declared), and "Before & after duty" stores `until > from` —
which `normaliseDay` refuses as `before-after-inverted`, so the button was an offer that could
never be saved. Found by the v20.75 review, verified end-to-end before fixing.

The rule (in `modesFor`, `overtime-format.js`): an overnight day offers Not available / All day /
**Before {start}** / Custom. The pre-duty gap is real, so "Before" survives; everything else the
member can say about that day, they say in their own typed times. The server schema is untouched —
`before_after` remains refusable when inverted, which is correct for the same-day case it models.
Do not "fix" this by accepting inverted pairs server-side: an inverted pair from a same-day duty
really is a transposed mistake, and the schema cannot tell the two apart after the fact.

### A day's answer is about a duty STARTING that day (owner, Aug 2026)

Settled in response to an external audit, which found the rule undocumented rather than wrong. The
app has always worked this way — answers are keyed by date, `nextDay` is derived from the two times
rather than asked, and the roster itself anchors every night turn to the day it starts on — but
nothing on either surface said so, and the ambiguity is not academic:

> Friday · available 22:00–02:00 next day
> Saturday · not available

Under the duty-start rule that pair is coherent and complete. Under a pure clock-availability
reading it is a flat contradiction, and a member holding that reading would enter the small hours
twice, on both days, producing a record neither they nor the clerk could act on. The reviewer is
exposed to the same misreading from the other side: seeing the pair as a contradiction and ringing
somebody to resolve one that does not exist.

So it is stated on both surfaces (v20.88) — the member's custom-times hint says the range still
belongs to the day it starts on, and both `?` panels carry the rule in their own voice. **No logic
changed**, and none should: the alternative reading would require a period crossing midnight to
feed into two dates, which is a materially more complicated model for a station where the roster
already anchors overnight turns by start date. If the interpretation is ever revisited, that is the
cost to weigh.

---

## "Up to 12 hours" — the one mode that is a ceiling, not a clock time (v20.83, owner)

Twelve hours is the legal ceiling of a turn, so the declaration means "I will work up to a 12-hour
day": a full 12-hour turn on a rest day, or extending a rostered duty to 12 hours total on a worked
one. It stores nothing but its mode — like `all_day`, there is no boundary a roster change could
invalidate, so `answerAnchorStale` never fires on it and the reviewer's chip needs no times.

**The offer is withheld on a day whose effective roster already reaches 720 minutes** — including a
12-hour RDW already agreed as extra — because on that day there is nothing left to offer and the
pill would be a question with no meaning. The gate (`modesFor`, keyed on `rosteredMinutes` from
`overtime-roster.js`) needs a POSITIVE fact to fire: an unknown day is not "already rostered
12 hours", so the pill shows there. That is the same direction every unknown resolves on this page —
withhold what would ANCHOR to an unverified roster (the before/after shortcuts), keep what anchors
to nothing (this, all-day, custom). The server accepts the mode unconditionally, deliberately: the
gate is about not asking a pointless question, not about policing a declaration that is valid
whatever the roster later becomes.

### The 12-hour ceiling is a rule, not an answer (v21.22, owner)

The owner's Aug 2026 review of the option set asked whether a member needs to press TWO pills —
"before or after my shift, but also up to 12 hours". The answer settled the model: **the 12-hour
ceiling binds every plan whatever a member answers**, so "before & after AND up to 12 hours" adds
nothing to "before & after" — the cap is not the member's to grant, and the form stays one tap per
day. Three consequences shipped together:

- **The cap is now STATED** — a standing `.ot-cap-note` above the day list ("However you answer, a
  working day is never planned past 12 hours in total"), because until it was said, the 12-hour
  pill reasonably looked like something you had to opt into.
- **The 12-hour pill is worded as what it uniquely adds** — willingness for the LONGEST day
  allowed: "For a full 12-hour turn" (rest) / "For a full 12 hours in total" (on duty). As "up
  to …" it read as a duplicate of "All day" on rest days.
- **The both-sides duplicate is folded**: on a normal worked day "Any time around my shift"
  (`all_day`) and "Before & after duty" meant the same thing to a clerk, so `modesFor` withholds
  `all_day` wherever `before_after` can be offered. The survivor stores the declared clock times —
  a later roster change flags the answer stale instead of silently re-pointing it, which is the
  schema's own philosophy. `all_day` stays on rest/spare days, overnight duties and unknown
  rosters, and a saved `all_day` on any day still renders (the form re-adds a stored mode).

Full multi-select was considered and rejected: it creates contradiction states the server would
have to referee, and every stored answer stops being one unambiguous statement — the property the
whole feature is built on.

### SETTLED at v21.24: the two dimensions split (owner)

External review of v21.22 pressed the point and it was right: with the cap stated, `twelve_hours`
was redundant on a rest day (where "All day" already permits a 12-hour duty) and actively unhelpful
on a worked one (it gave a DURATION with no WINDOW, so a clerk could not build a duty from it
without ringing the person). The reviewer's remedy was to delete it and keep 12 hours purely as the
planning ceiling — which is clean, and throws away the willingness signal the owner asked for at
v20.83.

The owner chose the third option: **split the dimensions rather than trade one for the other.**

| Question | Control | Stored as |
|---|---|---|
| When can you work? | the radio group | `mode` (+ its clock boundaries) |
| Would you work a long day? | an optional tick under it | `fullTwelve: true`, or absent |

Nothing now overlaps, and both answers are expressible at once — "before and after my duty, **and**
go long if it helps" is one unambiguous statement, which is exactly what the retired mode could not
make. Five consequences worth keeping:

- **`twelve_hours` is retired, not deleted.** Revisions are append-only and immutable, so beta
  answers stored under it live out their retention window; it stays in the schema, in `answerCopy`,
  and in the form's stored-mode fallback. Removing it would make real records unreadable.
- **"Up to" is correct on the tick and was wrong on the mode.** Beside a window it grants
  PERMISSION for a long duty rather than naming a duration — the ambiguity that retired the mode.
- **The flag is stored only when true**, so answers written before and after this change stay
  structurally comparable and nothing needs migrating.
- **It is refused beside `unavailable`**, server and client, and the chip never renders that pairing.
- **It survives a change of window but not a change to `unavailable`** — the two answers are
  independent, so moving the window must not silently retract it.

**It shipped in TWO pushes**, and anything similar must too: the three deploy workflows fire in
parallel, so a client that gained the field before the server accepted it would have met
`unknown-field` and refused real submissions for the length of the Functions deploy. v21.24 was the
server accepting it (inert, nothing sent it); v21.25 was the client offering it.

---

## Restoring is not the mirror of withdrawing (v21.26, external review)

`Stop asking` and `Ask again` look like one control in two directions. They are not, because only
one of them can make the app state something false about a person.

Withdraw somebody BEFORE a week's initial deadline, let the deadline pass, then restore them: they
are now expected for a deadline they were never asked about, so the moment they submit,
`deriveHistory` finds nothing accepted before it and marks them **submitted after initial deadline**.
True of the data, false of the person, on the screen a reviewer uses to judge who is responsive.

**The rule: after the initial deadline, a withdrawal may be undone only if the withdrawal ITSELF
happened after that deadline.** `canRestoreParticipant` in `functions/overtime-core.js`; the client
copy (`canRestoreNow` in `overtime-format.js`) only decides whether the button is offered.

This is not a new policy — it is the one the app already had, applied to the path that escaped it.
`addMissingParticipants` returns early unless a window is `INITIAL_OPEN`, so a newly eligible member
joins from the following week rather than being added late. Restoring now agrees with adding.

Three details worth keeping:

- **The two "unknown" cases run opposite ways, deliberately.** The server refuses an unreadable
  `withdrawnAt` — it is the protection, and a wrong yes writes a false record. The client offers the
  button when it does not know the deadline, because a wrong no puts a *sentence* on screen
  ("Stopped before the first deadline") explaining a refusal that may not exist, and a false
  explanation is believed where a refused tap merely costs a moment.
- **The gate is per PERSON, not per week.** A realistic week has somebody stood down early and
  somebody stood down yesterday; one answer for both is the bug.
- **The refused row says why.** A button that vanishes for one person and not another reads as a
  rendering fault, and the reviewer's next move is a reload that changes nothing.

---

## Per-day freshness (v21.26, external review)

A submission has ONE `updatedAt`, and the reviewer's rows printed their age from it. So a member who
answered the whole week a fortnight ago and edited only the Saturday this morning had all seven days
reported as declared today — always in the FRESHER direction, which is the one that costs something
when a clerk is arranging short-notice cover.

`dayChangedAt` (in both copies of `deriveHistory`) walks the append-only revisions and records, per
date, the instant that date's answer last actually changed. Derived rather than stored, for the same
reason `initialRevision` and `lateInitial` are: a stored summary is a second answer free to disagree
with the history it summarises. A no-op resubmission is not a change, and neither is a reordered
answer — structural comparison, like `sameAnswer`.

The whole-form receipt stays as it is, and remains the row's fallback: a revision read can fail while
the head is perfectly readable, and a coarse age beats none.

---

## Revisions, and why two of the interesting fields are not stored

A submission is a **head document plus an append-only `revisions` subcollection**, both written in one
transaction so a head can never point at a revision that does not exist.

`initialRevision` and `lateInitial` are **derived** from the revision list against the stored initial
deadline (`deriveHistory`), never stored. A stored copy is a second answer that can disagree with the
revisions it summarises — and the summary is the one a reviewer acts on.

`deriveHistory` is duplicated between `functions/overtime-core.js` (CommonJS) and
`overtime-format.js` (browser ESM), because Cloud Functions cannot import browser ES modules without
a build step. `overtime-parity.test.mjs` holds the two in step, like `surname-parity` and
`payday-cutoff-parity` before it.

---

## Concurrency: why `clientMutationId` exists

Submissions use optimistic concurrency on `ifRevision`. `decideSubmission` checks **no-op before
conflict**, deliberately: an identical retry after a timeout carries a stale `ifRevision`, and
refusing it would tell a member their availability did not save while it sits saved on the server.

The correlation id is generated in `overtime-data.js`, not by any call site, so none can forget it.
**A uid is not enough:** all of a member's devices share one Firebase uid, so uid alone cannot
distinguish this phone's lost request from another tab's. The id is what lets a timed-out client
re-read and recognise its own write — the difference between "your earlier submission did save" and
"a newer version is already saved; we haven't overwritten it".

A conflict is never auto-merged. The saved version is offered for the member to read and accept: an
automatic merge of two declarations about somebody's own availability produces a third that neither
of them made.

---

## Retention

Windows expire 91 days after their week-ending Saturday. **Both read endpoints omit expired windows
themselves**, so what anyone sees never depends on when a purge last ran, and a submission to an
expired window is refused with `no-window`.

It is deliberately *not* a Firestore rule. Rules are not filters: a `resource.data` condition on a
collection read fails the **whole query** rather than dropping a row, so one expired document would
blank a reviewer's entire workspace.

**The purge exists and ships DISARMED** (v20.96). `purgeExpiredOvertimeWindows` runs daily at 04:00
Europe/London — an hour before the creator, so the two never contend — selects every window past its
`retentionUntil`, walks it bottom-up and reports exactly what it would remove. `purgeArmed` in
`functions/index.js` is the one statement that turns the report into a deletion.

Disarmed is not indecision. It is the only irreversible thing this feature does, it runs unattended,
and its first real work happens months after it was written — so the walk gets proved against real
documents while its mistakes are still only log lines. **Read a run of `[purgeExpiredOvertimeWindows]`
in the Functions log, check the weeks and the counts, then arm it.** Nothing anybody SEES changes
either way, since both read endpoints already omit expired windows; that is why arming can wait and
also why waiting is not free — the data is still there.

Two properties the walk depends on. **Firestore does not cascade**: a parent deleted on its own
leaves every participant, submission and revision present, billable and unreachable from any listing
the app performs, which is worse than not purging because the data survives while the system reports
it gone. And the **parent goes last** — an interrupted run then leaves a window that is still
expired, still invisible and still selected tomorrow, where the reverse order would strand the
children with nothing able to find them again. A run clears at most five windows and states in its
log how many it left, because a run that reports only what it did reads as a complete one.

---

## Read permissions

```
match /overtimeWindows/{weekEnding}/{document=**} {
  allow read: if request.auth != null && (
    request.auth.token.admin == true || request.auth.token.manager == true
  );
  allow write: if false;   // Admin SDK only — functions/overtime.js
}
```

Ordinary members get **nothing** from Firestore directly; their whole world arrives through
`getMyOvertimeState`, which resolves participation server-side. Reviewers read the tree directly
because the by-day workspace benefits from it and they are entitled to the data anyway. No client of
any kind may write — every mutation goes through the transactional endpoint.

The page's access gate is a **client courtesy, not the boundary**. It decides what to render so an
ordinary member who types the URL sees a short "not open to everyone yet" panel rather than a blank
page; it stops nobody, and is not relied upon.

---

## Operating it

**Weeks create themselves.** `autoCreateOvertimeWindows` runs daily at 05:00 London and creates
every horizon week that has none. Nobody has to remember anything, and the participant snapshot —
the security model — is frozen at a predictable time each week rather than whenever somebody
happened to press a button.

Daily rather than weekly, because a weekly job that misses its run loses a whole week and the window
may pass its deadline before the next one. Daily is self-healing, and the repeat runs are free: the
work is idempotent, so six of every seven runs read one collection and stop.

**The horizon did not become redundant — it changed job.** It was the safety net under a human; it
is now the monitor over the scheduler. That still works because it is computed from the *calendar*,
not from Firestore, so a week the job failed to create still appears, still says "Not created", and
still offers the button.

**Creating a week by hand** is therefore a fallback, not the routine: Overtime → Upcoming weeks →
*Create*. The confirm bar previews the roster week, the initial deadline, the audience and the
expected participant count — the same server code that will commit it, run with `dryRun: true`, so
the preview cannot drift from the result. Press *Open the form* to commit. The scheduler and the
button call one `createWindow`, so they cannot disagree about what a window is.

Automatic creation was DEFERRED in the original specification (§6.2, "beta will show whether manual
creation is sufficient") and shipped at v20.61 once the owner settled the question it was waiting
on: overtime is needed every week, so a window is needed every week.

**During the window.** Reviewers watch *Who is available* for the selected week: three sections per
day — Available, Not available, **No response** — which must never merge. One person said no; the
other said nothing, and a reviewer who cannot tell them apart cannot know who is worth a phone call.
*Awaiting a form* is the list a reminder works from.

**After the final deadline.** The form goes read-only and states the deadline it closed at. The
workspace keeps a standing note that availability reflects what was submitted before the cut-off and
that short-notice cover should be confirmed with the employee directly.

**When a member is locked out or renamed**, or when a new starter needs to appear: regenerate
`functions/roster-members.json` and re-run Operations → Set up accounts. Existing windows keep their
frozen populations either way.

---

## First-release deploy ordering

A push touching this feature fires all three deploy workflows **in parallel**, with no ordering
guarantee: Hosting (the page), Functions (the endpoints) and Rules (the read permission). Until all
three land, the page renders and reports a load failure — which is the correct behaviour and is
self-healing within a minute or two. No client is holding stale Overtime data to be confused by,
because none existed before.

---

## Known temporary exceptions

Two, both stated in full in `ARCHITECTURE.md` → §3 and deliberately not re-explained here:

- **`EXC-002`** — the retention purge ships **disarmed**. It reports; it deletes nothing, so expired
  data persists contrary to what *Retention* above says happens to it. `VAL-OT-001` is the evidence
  that closes it, after 21 Nov 2026.
- **`EXC-003`** — participation is a **restricted beta**. The audience ladder is server-owned, so
  widening it is a one-word edit plus `npm run generate:roster-members`.

---

## Push notices (v21.47) — targeted, and why that is the design rather than a limitation

The feature runs on deadlines, and until v21.47 nothing nudged anyone: a window opened silently
overnight and the initial deadline passed silently at noon. A member who did not happen to open the
app that week became a permanent **No response** — the record the reviewer's workspace treats as
its most load-bearing distinction, manufactured by the absence of a reminder rather than by the
person. Two notices close that, both built by the pure `askedNotice`/`reminderNotice` in
`overtime-core.js` and both sent by `sendTargetedPush` to member uids resolved from the account
email (the SAME derivation `setupRosterAuth` provisions with, so the two cannot disagree):

- **Asked** — when a member joins a window's population, at creation or by the nightly top-up. ONE
  notice per member per scheduler run however many weeks it put them into, naming their soonest
  initial deadline: the tag collapses the lock screen, but each send still buzzes, and five buzzes
  in five seconds about one page is not this app's register.
- **Reminder** — the morning the initial deadline falls, ONLY to participants who have submitted
  nothing (a withdrawn participant is no longer asked; somebody who answered has nothing to be
  reminded of). `reminderDue`'s 24-hour lookahead selects exactly one 05:00 run per window, and the
  server-written `reminderSentAt` stamp makes that morning idempotent.

**There is deliberately no broadcast branch.** During the restricted beta a fan-out would ping ~50
staff about a two-person pilot; at full launch, targeted-to-participants IS everyone eligible, so
the reach widens with the audience automatically and no notification code changes at launch. A
member with no Firebase account or no subscribed device is silently skipped — fail closed, per
member — and no push can ever fail the write it announces.

---

## Full-launch checklist — everything that changes when the beta ends

Consolidated here (v21.47) because these items previously lived across four documents and one being
missed would ship a half-launched feature. Work through ALL of them; each names its home.

1. **Widen the audience** — the one-word edit in `functions/overtime.js`'s `currentAudience`
   (`EXC-003` above), plus `npm run generate:roster-members`.
2. **Drop `CONFIG.OVERTIME_BETA`** from `roster-data.js` and regenerate — participation then follows
   eligibility alone. The nav pill and page policy already gate on `canOpenOvertime`, which needs no
   change (auth-policy.js keeps the reviewer/participant split).
3. **Remove the beta banner** (`.ot-beta` in `overtime.html`) and the "restricted live beta" wording
   in the page's tips (`overtime-tips.js`).
4. **Arm the retention purge** — `purgeArmed` in `functions/index.js`, after reading a dry run
   (`EXC-002`; evidence row `VAL-OT-001`, dated in `MAINTENANCE_CALENDAR.md`).
5. **Re-check the reviewer workspace at scale** — the By-day view renders every participant under
   every date; at ~50 staff that is ~350 rows under the ALL lens. Decide between defaulting the day
   lens to the week's first date and collapsible day sections. (The empty-section invariant stands
   either way: a hidden "No response" makes "nobody outstanding" look like a render failure.)
6. **Finish the revision-read economics if needed** — v21.47 already skips the read for
   single-revision heads (most members), so the remaining cost is one read per member who resubmitted.
   If that ever matters at 50 members, lazy-load revisions on row expand; never store a derivation.
7. **Notifications need nothing** — see above; targeted reach scales itself. Confirm the asked
   notice's first full-roster morning in the Functions log (`[overtimeAsked]`) the day after launch.

---

## Deliberately not built
- **The scheduled purge ships disarmed** — see `EXC-002` above.
- **No override write-back.** Availability is a declaration, not a roster change; nothing here
  writes to `overrides`.
- **No collection-group query, and so no composite index.** Participation is resolved by point reads
  across the retained windows — a couple of dozen at most — which keeps the first release free of the
  index deploy-ordering dance.
