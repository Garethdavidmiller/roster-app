# Overtime Availability — feature design

*Not version-stamped; not a runtime asset. Shipped v20.56–v20.61.*

Staff declare, per day, when they are available for overtime in a future roster week. A reviewer
(Manager or Master Admin) reads the answers by day and plans cover from them.

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
the moment creation was automated: the scheduler keeps eight weeks made in advance, so by the time
anybody is invited, every week they could usefully answer already exists. "Untouched" quietly meant
"an audience change never takes effect". It was reported live — a member added to the beta was told
"no forms are open for you" while the admin's were open, and her first form would have been a week
in October. At full launch the same arithmetic strands the entire roster for eight weeks.

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

The reviewer can SEE the gap because `getOvertimeManagerOverview` returns `audienceCount` — what the
current audience would select for that week — beside the frozen `expected`. Without it the week looks
complete, because everyone *in* it has answered. It is `null` for a closed week, so the row cannot
offer an addition the server would refuse.

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

---

## Revisions, and why two of the interesting fields are not stored

A submission is a **head document plus an append-only `revisions` subcollection**, both written in one
transaction so a head can never point at a revision that does not exist.

`initialSnapshot` and `lateInitial` are **derived** from the revision list against the stored initial
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

**There is no scheduled purge yet, and that is a dated obligation rather than a choice.** Expired
windows are invisible and inert, so nothing breaks — but the retention design says the data is
removed, and until the purge exists that is not true. It is booked in `MAINTENANCE_CALENDAR.md`:
warning at 10 weeks after the first real window, hard requirement before that window turns 13 weeks
old. Firestore does not cascade, so the purge must delete revisions, submission heads, participants
and the window parent explicitly — deleting the parent alone orphans the rest permanently.

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

## Deliberately not built

- **No reminder notifications.** The horizon is the guard against a missing window; nudging
  non-responders is a later decision with its own design (see `.claude/rules/notifications.md` —
  anything naming one person must use `sendTargetedPush`, never `fanOutPush`).
- **No scheduled purge.** See Retention.
- **No override write-back.** Availability is a declaration, not a roster change; nothing here
  writes to `overrides`.
- **No collection-group query, and so no composite index.** Participation is resolved by point reads
  across the retained windows — a couple of dozen at most — which keeps the first release free of the
  index deploy-ordering dance.
