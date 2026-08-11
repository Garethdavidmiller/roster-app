# OVERTIME_PLAN.md — Overtime Availability

*Planning document, opened August 2026. Not version-stamped; not a runtime asset. Design lives here;
once the feature ships, the CURRENT invariants move to `OVERTIME_AVAILABILITY.md` and this file keeps
only the argument for why the design is what it is.*

**Status: NOT STARTED.** Three prerequisites stand in front of it — see §14.

This supersedes the earlier drafts of the specification. Where it conflicts with them, this wins. It
is organised by DECISION with the reasoning attached, rather than as a numbered instruction list,
because the reasoning is the part that stops the next person undoing something on purpose.

---

## 1. What this is, and what it is not

A new first-class page — nav `⏱️ Overtime`, heading `⏱️ Overtime availability` — that collects
genuine employee availability so the roster clerk and Managers can use it when preparing the weekly
roster.

**It is not an allocation system.** It must never allocate or offer overtime, provide accept/decline,
mark somebody selected, write an override, touch Calendar or Pay, or tell an employee they have been
given overtime. The released roster stays authoritative, and the staff copy says so:

> Tell the roster team when you're available for overtime. Submitting availability does not guarantee
> overtime. Any overtime allocated to you will appear when the roster is released.

Managers may also consult retained availability *during* a roster week for short-notice cover, then
contact the person by phone or in person. Automated contact is out of scope.

**Non-goals, explicitly**: allocation · offer/accept/decline · vacancy broadcast · automatic roster
changes · Pay integration · fairness ranking or scoring · auto-contact · Working Time or fatigue
decisions · reasons for unavailability · phone numbers · Manager editing an employee's declaration ·
AI · automatic weekly window creation.

The name is a known compromise. "Overtime" is what staff say and what they will look for in a drawer;
"Availability" would be more honest and less findable. The page heading carries the honesty. Revisit
after beta if staff vocabulary says otherwise — but not before, and not by adding a second entry.

---

## 2. The invariants

Everything below serves these. If an edit breaks one, the edit is wrong.

| # | Invariant |
|---|---|
| 1 | **Membership** — a frozen participant record defines who was asked for that week. Nothing else does. |
| 2 | **No response is unknown, never unavailable.** It must not merge with "unavailable" in counts, colours, sections, reminders or history. |
| 3 | **History** — immutable revisions are authoritative for what was accepted and when. The submission head is a cache. |
| 4 | **Time** — the server decides whether a write is in time. The client clock is presentational and never a gate. |
| 5 | **Concurrency** — a stale client never silently overwrites newer availability. |
| 6 | **Deadlines are frozen** — a historical window keeps the timetable it actually ran under. |
| 7 | **Roster context** — unknown override state never becomes a plausible-looking base roster. |
| 8 | **Availability is not allocation.** |

---

## 3. Beta is real use — and there are THREE rungs, not two

The first release is a restricted live beta. It is not a sandbox: submissions are genuine availability
that H. Croft may use when building the real roster. Production Firebase, production identities,
production deadlines, production rules. "Beta" means *restricted audience plus ongoing UX refinement*,
never *disposable data*.

Restrained page copy:

> **BETA · Live use** — Availability submitted here is real and may be used when preparing the roster.
> The feature is still being refined.

### The three rungs

The earlier drafts went from one submitter straight to the whole team. That cannot work, and the gap
is the plan's biggest structural risk rather than any part of the code.

| Rung | Participants | What it can prove | What it cannot |
|---|---|---|---|
| **A — restricted** | G. Miller only | the software works end to end in production; H. Croft can read a form and use it | anything about counts, grouping, awaiting lists, reminders, or whether people submit |
| **B — pilot** | 3–5 volunteer CEAs | real no-response rows, real by-day grouping, real reminder targeting, real friction | full-scale response rate |
| **C — live** | all eligible staff | — | — |

Rung B costs nothing architecturally: the participant selector is already a server-owned policy, so
it is a third intersection, not a new mechanism. It also means the first non-admin user of the
feature meets it in a four-person pilot rather than on launch day.

**Do not skip B.** A 1-of-1 count exercises none of the presentation this feature exists for.

---

## 4. Who may do what

### Eligibility is roster participation — one definition, not two

The roster already models this. Use the canonical semantics:

```
!hidden && !managerOnly
```

which naturally includes G. Miller, excludes H. Croft and every other manager-only account, and
excludes hidden leavers. **Do not add a second policy** such as `!isManager || isAdmin`: it is
redundant today (every manager row carries both flags — `roster-data.js:304-309`) and it disagrees
with the roster the moment a manager is ever rostered. If the policy must change, change the
canonical semantic deliberately.

### The server list is generated, not hand-written

Extend `scripts/generate-roster-members.mjs`. Add to the generated artefact:

```json
{
  "overtimeEligibleMembers": [
    { "name": "G. Miller", "grade": "CEA", "startDate": null, "rosterOrder": 12 }
  ],
  "maxRosterYear": 2030
}
```

Three things this buys:

- `sw-asset-check.test.mjs` already CI-locks the generated file against `roster-data.js`, so a new
  starter added without regenerating fails the build. The guard is inherited, not built.
- `rosterOrder` is generated — never hand-maintained — so Manager displays keep a stable familiar
  order months later.
- `maxRosterYear` mirrors `CONFIG.MAX_YEAR` (2030 today). Window validation is server-side and would
  otherwise invent its own horizon. Bumping `MAX_YEAR` then moves both at once, which matters because
  that bump is already scheduled in `MAINTENANCE_CALENDAR.md`.

⚠️ **Do not derive participants from the existing `activeMembers`.** It is built from
`getMembersForGrade`, which deliberately does *not* filter Management on `hidden` — so it contains all
six managers, H. Croft included. It means "has an account", not "is rostered".

### Participant selectors

| Rung | Selector |
|---|---|
| A | `overtimeEligibleMembers` ∩ server-owned admin entitlement |
| B | `overtimeEligibleMembers` ∩ a server-owned pilot list |
| C | `overtimeEligibleMembers`, subject to start-date-on-week semantics |

Pin the *expected current result* of each with a test, but keep the implementation semantic — never
a literal name comparison in permission logic.

### Roles

| Account | Page | Submit | Review | Create windows |
|---|---|---|---|---|
| Rostered Master Admin (G. Miller) | ✓ | ✓ | ✓ | ✓ |
| H. Croft / any Manager | ✓ | ✗ | ✓ | ✓ |
| Ordinary member (rung A/B, not selected) | ✗ | ✗ | ✗ | ✗ |
| Calendar Viewer | ✗ | ✗ | ✗ | ✗ |

---

## 5. The weekly window

Roster weeks run Sunday to Saturday and are named by the Saturday. The Saturday ISO date is the
**deterministic document id** — `overtimeWindows/2026-09-05` — which prevents duplicate weekly forms
structurally rather than by checking.

### Server-owned timetable

The browser never implements deadline policy. Given week-ending Saturday `W` the server derives and
**stores**:

| Milestone | Offset | Day |
|---|---|---|
| Roster start | W − 6 | Sunday |
| Initial availability deadline | W − 18, 12:00 | Tuesday |
| Draft roster date | W − 16 | Thursday |
| Final availability deadline | W − 11, 12:00 | Tuesday |
| Final roster date | W − 9 | Thursday |
| Week ending | W | Saturday |
| Retention cutoff | W + 13 weeks | — |

Worked example, week ending Sat 5 Sep 2026: roster week Sun 30 Aug – Sat 5 Sep · initial deadline Tue
18 Aug 12:00 · draft Thu 20 Aug · final deadline Tue 25 Aug 12:00 · final roster Thu 27 Aug.

### Storing derived dates is deliberate

Every milestone above is computable from `weekEnding`, and is stored anyway alongside a
`policyVersion`. **This is not a duplication to tidy away.** If the offsets ever change, a 2026 window
must keep the deadlines it actually ran under — the same argument as the frozen participant snapshot,
applied to dates. Never recompute an existing window's milestones from current policy.

### ⚠️ The London-time helper is the highest-risk function in this plan

"The Tuesday eighteen days before Saturday W, at 12:00 Europe/London, as an absolute instant" has to
be written by hand — this app has no date library and no build step — and every deadline, phase
decision and historical derivation depends on it. 18 Aug 2026 is BST, so 12:00 local is 11:00Z; a
window created in January for a July week must get that right, and the failure mode is silent and an
hour wide.

Write it **first**, in `functions/overtime-core.js`. Derive the offset from `Intl.DateTimeFormat` with
`timeZone: 'Europe/London'` rather than any arithmetic over month numbers. Pin both 2026 transitions,
a week that straddles one, a year boundary and a leap year.

### Creation validation

Reject: malformed or impossible dates · non-Saturday week endings · a week whose **final** deadline
has already passed · a week beyond `maxRosterYear`.

---

## 6. Three phases, and who owns the clock

```
INITIAL_OPEN   serverNow <  initialDeadlineAt          first-submit or amend
FINAL_OPEN     initialDeadlineAt <= serverNow < finalDeadlineAt   first-submit or amend
CLOSED         serverNow >= finalDeadlineAt            read-only
```

At exactly the deadline the later phase applies. The Thursday dates are informational; they are not
states. A first-ever submission in `FINAL_OPEN` was not available at the draft-planning cut-off —
which is a *derived* observation (§8), not a stored flag.

### The client clock is presentational

`getMyOvertimeState` returns `serverNow`. Compute the offset with the round trip removed:

```
rtt    = tReceive - tSend
offset = (serverNow + rtt / 2) - tReceive
```

Refresh on bootstrap, after submission, on visibility resume, and periodically while a deadline is
near. A device that sleeps and re-syncs its clock invalidates the offset, which is why resume matters.

### The client must never hard-block

**`OVERTIME_SUBMIT_GRACE_MS = 15 * 60_000`.** If corrected time says the window is closed but is
within that band of `finalDeadlineAt`, the client still sends and lets the server answer; the button
says "Deadline may have passed — checking…". Only beyond the band does the client render read-only.

A named constant, not "several minutes" — this is the one place a developer would otherwise have to
invent a number, and the reasoning (clock skew plus round trip) belongs beside it. A client that
refuses to send has denied somebody who was in time, with no recourse; a server rejection at least
produces a true message.

---

## 7. Data model

```
overtimeWindows/{weekEnding}
    weekEnding · weekStart
    initialDeadlineAt · draftRosterDate · finalDeadlineAt · finalRosterDate
    retentionUntil · policyVersion
    audience            'restricted' | 'pilot' | 'all'   — PROVENANCE LABEL ONLY
    createdAt · createdByName · createdByUid

    participants/{memberName}
        memberName · uid · grade · rosterOrder · createdAt

    submissions/{memberName}
        memberName · uid · currentRevision · days
        firstAcceptedAt · updatedAt · lastMutationId · schemaVersion

        revisions/{revisionId}
            weekEnding · memberName · uid · revision
            days · acceptedAt · mutationId · schemaVersion
```

**No `expectedCount`.** The participant subcollection *is* the expected population; a stored count is
a second answer that can disagree with it after a part-failed creation. Counts are derived: expected =
participant docs, received = submission heads, no response = the difference.

**No `lateInitial`, `initialSnapshot`, `selected`, `contacted`, `allocated` or `accepted`.** Each is
either derived (§8) or belongs to a feature that does not exist.

**`audience` is a label.** It records which selection policy ran, for Manager history and beta
marking. It is never consulted for authorisation and never appears in a query predicate — window
membership is the security model (§9).

### The head is a cache, and must say so

The submission head duplicates the current revision on purpose: it lets a Manager list twenty-four
people's current availability without loading history. The transaction guarantees
`currentRevision`, `days`, `updatedAt` and `lastMutationId` match the revision they represent.

**Historical meaning is never derived from the head.** Anything about initial-cut-off state, lateness
or change reads the revision documents. A head that ever drifted would otherwise produce a Manager
view that is wrong with nothing to signal it.

### Revision fields are not optional

`weekEnding`, `memberName` and `uid` go on every revision **from the first beta release**. Beta
revisions are real, retained, immutable records — a field added later is a field the earliest history
does not have, so any collection-group query built afterwards silently excludes exactly the records
you were most careful to preserve. The cost is a few dozen bytes on a document written a handful of
times per person per week.

---

## 8. History is derived, not stored

| Question | Derivation |
|---|---|
| What did the clerk have at the initial cut-off? | the latest revision with `acceptedAt < initialDeadlineAt`; none ⇒ no initial submission |
| Submitted late? | a submission exists and no revision precedes `initialDeadlineAt` |
| Changed since initial? | normalised days of the initial-cut-off revision ≠ head |

If somebody changed something and changed it back exactly, no current-state difference is shown — the
revision history still proves the intermediate change if it is ever needed. If H. Croft later wants
"anyone who touched it after Tuesday, even reverted", the data already supports it with no schema
change.

---

## 9. Security

### Window membership is the model

The authoritative answer to *"was this employee part of this week's process?"* is *"does the frozen
window contain a participant record for them?"* That one rule handles beta history staying private
forever, staff joining after a window was created, leavers, changing composition, and response-rate
integrity. A new employee must never appear as a historical non-responder.

### Client rules stay small

Ordinary participants **do not read Overtime Firestore directly** — they use `getMyOvertimeState`
(§10). No client of any kind ever writes. So:

```
reviewer (manager or admin claim)    read
everyone else                        denied
every client, including admin        no writes, ever
```

That is a ruleset you can be certain about, and every branch of it is exercised in production.

### Retention is NOT enforced in rules

The earlier draft put `request.time < retentionUntil` in the read rule. Drop it, for two reasons.

**Rules are not filters.** A condition on `resource.data` does not exclude a document from a list — if
any returned document fails, the whole query fails. A Manager listener over a collection holding one
expired document would return nothing rather than everything else.

**It can only constrain the authorised reader.** Managers are the sole client readers and they are
entitled to this data. A rule hiding expired-but-unpurged records protects it from nobody; it just
adds a `get()` on the parent window to every subcollection read path and turns a three-line ruleset
into fifteen.

Retention is enforced where it is visible and testable: both endpoints filter on `retentionUntil`
(§10, §12), so behaviour does not depend on when the purge last ran.

### Identity

Every interactive endpoint uses `verifyIdToken(bearer, true)` — revocation checking mandatory, not
preferred, matching `functions/auth-endpoints.js:103`. Canonical identity is `decoded.name` from the
server-managed claims. Never trust `body.memberName`, `body.role` or `body.uid` as identity.

**Admin cannot impersonate.** Even Master Admin cannot submit S. Silva's availability through the
normal endpoint; submission identity is always the authenticated caller. Pin it with a test.

### Name-keyed documents

Participant and submission ids are canonical member names, for legibility and consistency with
`staffContact` / `passwordStatus` / `resetRequests`. Two consequences:

- **Generated-name hygiene test.** Every name in `overtimeEligibleMembers` must be a legal Firestore
  path segment and must equal `decoded.name` byte for byte. A future starter's name is generated data
  nobody inspects; this must fail CI, not corrupt a path in production.
- **Known limitation.** Renaming a member orphans their name-keyed history. The `uid` stored on every
  participant, head and revision is the recovery route. Record it in `OVERTIME_AVAILABILITY.md`; do
  not redesign around opaque keys for a rare event.

---

## 10. Endpoints

Four for the restricted beta. `functions/overtime.js` (orchestration) and
`functions/overtime-core.js` (pure), with `functions/index.js` staying the composition root.

**`createOvertimeWindow`** — reviewer only. Takes `{ weekEnding, dryRun }`. **There is no separate
preview endpoint**: the same code authenticates, validates, derives the timetable and selects
participants, and `dryRun: true` simply returns the result without writing. That makes preview drift
structurally impossible. Creation writes the parent and every participant document in **one batch**;
if the population would exceed the safe batch bound the call fails clearly rather than half-creating a
window. Duplicate creation is idempotent — the deterministic id means the second caller opens the
existing window and never rewrites its snapshot.

**`getOvertimeManagerOverview`** — reviewer only. Returns `serverNow`, the next ~6 actionable roster
weeks with their computed milestones and whether a window exists, and retained window metadata. This
is the endpoint that prevents the silent failure in §11.

**`getMyOvertimeState`** — the employee's only read path. Returns `serverNow`, the retained windows in
which the caller holds a participant record, participant metadata, their own submission head, and
authoritative milestones. Never colleague data. Filters out `retentionUntil <= serverNow`.

> **A Manager calling this correctly receives `{ serverNow, windows: [] }`.** Managers are not
> participants. That is not a bug and must not be "fixed" by granting Managers participant semantics —
> their window list comes from the overview endpoint.

Use a server-side `collectionGroup('participants')` query keyed on the caller's name rather than
probing ~19 window paths one at a time. The index ships in the rules commit and the code that uses it
ships in the next one, which satisfies the lead-time discipline in §13 for free.

**`submitOvertimeAvailability`** — see §11.

Later, during beta: `sendOvertimeReminders`, `purgeExpiredOvertimeWindows`.

---

## 11. Submission, concurrency and the timeout path

### The form

Exactly seven explicit answers, Sunday to Saturday. An untouched date is **unanswered**, never
unavailable, and Submit is blocked until all seven are deliberately answered.

Modes: `unavailable` · `all_day` · `before` · `after` · `before_after` · `custom`.

For a known duty of 07:00–15:00 the UI offers *Not available · Available all day · Available before
07:00 · Available after 15:00 · Available before & after duty · Custom times*. For an RD it offers
*Not available · Available all day · Custom times*.

**Store concrete boundaries.** "After 15:00" stores `{ mode: 'after', from: '15:00' }` — never
`after_current_shift`. The roster may change afterwards, and the declaration must remain what the
person actually said. **All-day is semantic**: store `mode: 'all_day'`, never a fabricated 24-hour
shift, and never run availability through pay or duration maths.

Custom times accept `18:00–23:00` and overnight `22:00–02:00` (rendered "next day"), and reject
`08:00–08:00`. Reuse the app's existing HH:MM validation rather than writing a fourth clock parser.

**No free-text reason, no notes field.** The operational question is *when can you work* and nothing
more; a reason field collects health, childcare and family circumstances for no benefit.

### Optimistic concurrency

Every mutation carries `ifRevision` (`0` for a first submission). Inside a Firestore transaction the
server reads the head, normalises the incoming content, and:

- **content identical to the head** → success, no new revision, no conflict — *even if `ifRevision` is
  stale*, because the caller is trying to save what is already authoritative. **It still updates
  `lastMutationId` and `updatedAt`.** Without that, a retry that succeeds as a no-op cannot be
  confirmed by the next reconciliation, and §11's timeout flow reports "couldn't confirm" for a
  submission that is definitively saved.
- **content differs and `ifRevision !== currentRevision`** → `409 Conflict`, nothing overwritten.
- **content differs and `ifRevision` matches** → append revision `n+1`, update the head, atomically.

`links-concurrency.js` exists because silent overwrite shipped three times (v16.19, v16.23, v17.18),
each discovered only when a colleague reopened their work. Same bug class.

### `clientMutationId`

Every attempt carries a client-generated random id, stored on the revision and as `lastMutationId` on
the head. It is correlation metadata, never business state. It is needed because **all of a member's
devices share one Firebase uid**, so uid alone cannot distinguish "my phone's timed-out submit" from
"my desktop tab".

### Timeout reconciliation

A timeout stops us waiting; it does not stop the server working. So on timeout the form does **not**
drop back to an ambiguous editable state. Instead:

1. Show "Checking whether your form was saved…"
2. Re-read `getMyOvertimeState`.
3. `lastMutationId === timedOutMutationId` → "✓ Your earlier submission did save." Update local state.
4. Proved not saved → return to editable with a retry.
5. Still offline → "We couldn't confirm whether your form was saved. Check this week again when
   you're online before submitting another version."

And the interaction the earlier drafts missed: if the member **edits** between the timeout and the
retry, content now differs *and* `ifRevision` is stale, so they get a 409 for a change **they made
themselves**. The 409 payload therefore carries the head's `updatedAt` and writing `uid`/mutation id,
and the copy branches:

- known earlier timed-out mutation → "Your earlier submission did save. Here's what's currently
  stored. Review it before making further changes."
- otherwise → "A newer version of this form is already saved. We haven't overwritten it." + *Review
  latest version*.

**No automatic merging.** Seven days is small enough for a person to review, and truth beats
cleverness.

### Offline

Do not queue availability writes. Offline shows "A connection is required to submit overtime
availability", and nothing shows a successful submission before the server has acknowledged it.

---

## 12. The missing window, and the Manager workspace

### The silent failure this feature would otherwise have

A weekly-window system has one dangerous hole: **nobody creates the window.** Then no participants
exist, nobody is outstanding, reminders cannot fire (they key off a window), staff see nothing, and
H. Croft plans a roster from a page that is quietly empty. "No window" is indistinguishable from "no
overtime needed". It is the same class of failure that `report-deploy-failure` exists for, and the
reminder scheduler cannot cover it, because the thing that failed to happen is the thing reminders
key off.

**The Manager workspace therefore always shows a planning horizon independent of existing windows** —
the next ~6 Saturdays, marked created or not:

```
Week ending Sat 5 Sep    Created      1 of 1 received
Week ending Sat 12 Sep   NOT CREATED  Initial deadline Tue 25 Aug · 12:00   [Create]
```

Escalate the treatment when the initial deadline has passed and the final has not. Once the final
deadline passes, creation is refused. **Never infer "no window = no overtime required"** — if a
deliberate "no form this week" state turns out to be needed, add it when beta shows it.

This is required scope, not a refinement. Automatic weekly creation stays a non-goal; visibility of
the omission does not.

### The rest of the workspace

Priority order, because the workspace exists to answer one question — *who is available on this
date?*

1. **Upcoming weeks** (including not-created) — above.
2. **By day** — the primary operational view. Available (with times) · Not available · No response,
   as three distinct groups in `rosterOrder`.
3. **Awaiting** — participants with no submission head.
4. **Changes** — late and changed-since-initial, initially folded into By day rather than its own tab.

**By person is deferred** until H. Croft asks for it; the data already supports it.

Beta labelling is mandatory: `BETA · Restricted audience · 1 expected participant`, so 1-of-1 is never
mistaken for a whole-team response.

Manager reads for the *selected* window use direct Firestore listeners on participants and submission
heads, so a form appears the moment it arrives. Do not attach listeners across thirteen weeks of
history; load revisions on demand.

### During the roster week

Show the submitted availability **and the person's current effective roster** side by side — someone
who offered "all day, RD" may since have been given overtime in the final roster. With the warning:

> Availability reflects what staff submitted before the final cut-off. Confirm directly with the
> employee before arranging short-notice cover.

---

## 13. Roster context

Reuse `resolveEffectiveShift` from `override-utils.js` — the shared override→display ladder the
renderer, Team View and legend already use. Do not build a second precedence ladder.

Reuse the pure decision logic in `calendar-data-state.js` — `unknown` / `cached` / `authoritative` /
`error` and `decideDisplay`. **But do not share its module-level month-state map**: it is process-wide
singleton state keyed by month, and Overtime needs its own keying. If sharing the pure helper requires
touching that module, characterise Calendar first — a correct Calendar is worth more than a shared
function.

**Never display an unverified base roster as current** (invariant 7). When context is unknown or
errored:

- *Member* — can still answer Not available, All day, Custom. The roster-derived shortcuts (before
  duty / after duty / before & after) are hidden, with "Couldn't confirm your current MYB roster. You
  can still enter availability using custom times."
- *Manager* — submitted availability still shows; the roster column says "Roster unavailable · Retry".

Test the exceptional dates explicitly, because they are exactly when overtime matters most: Sunday ·
Christmas Day and the Christmas RD rule · RD · RDW · AL · absence · shift override · month boundary ·
year boundary. Audit for display-only suppressions in the Calendar that must **not** be imported here
— Calendar suppresses `sick` on Sundays for presentation reasons, and Overtime weeks start on Sunday.

---

## 14. Delivery

### Prerequisites — before any Overtime work

1. **`fetchWithTimeout` caller-abort distinction.** The submit UI depends on telling *our* timeout
   ("may still have been processed") from a navigation cancellation ("intentionally cancelled"). Only
   the first may say "your form may have saved". Tests required.
2. **Calendar PIN rules closure**, if still outstanding. `firestore.rules:147` still carries the
   `allow read;` hold, so override data remains public; do not add a second collection with subtle
   read rules while the first tightening is unfinished.
3. **Named-account access stable enough to interpret a response rate** — not blocking for rung A,
   blocking for rung C.

### Milestones — not a session estimate

Six units of work, of which two are features in their own right. Treat M5 and M6 as likely to split.

| # | Milestone |
|---|---|
| M1 | Generator extension (`overtimeEligibleMembers`, `maxRosterYear`, doc-id hygiene) · London-time policy helper · participant selectors · revision/diff/concurrency pure functions · unit tests |
| M2 | Firestore structure and constants · reviewer-read rules · all client writes denied · participants collection-group index · emulator tests |
| M3 | `functions/overtime.js` + `overtime-core.js` — create with `dryRun`, manager overview, member state, submit with mutation ids and optimistic concurrency · export-surface test |
| M4 | `overtime.html` + boot + CSS · auth policy · nav · beta gating · analytics · the full new-page contract (§15) · **Manager upcoming-six-weeks view** |
| M5 | My availability — seven-day form, roster context, server clock, submission, timeout reconciliation, conflict UX, read-only history |
| M6 | Manager workspace — By day, Awaiting, derived counts, changed/late indicators, roster context, revision drill-down |

**Then stop and use it for a real roster cycle.** Do not continue into reminders, print, By-person,
copy-last-week or any other automation before real use has said which of them matters.

### Deploy ordering — two specific traps

Both workflows fire in parallel from one push, which the PIN rollout already taught.

- **Indexes build asynchronously.** Never ship a query and its index in the same release. M2 deploys
  the index (`deploy-rules.yml:75` ships rules and indexes together), M3 ships the code that uses it.
- **The analytics allowlist.** Adding `overtime` to the `counts` map needs `firestore.rules:617`
  updated. If Hosting lands first, overtime page-view writes are denied for the lag. Not dangerous —
  but `analytics/origins` was made a separate document specifically so a rules lag could not deny
  writes that already work. Ship rules first, or accept and state the loss.

### Later beta, in this order

Reminders (per-week tags, observability) → automatic retention purge → whatever real use has asked
for. Reminders are **not** a prerequisite for first real use: prove *real form → real submission →
real rostering use* first, then add reminders while the audience is still restricted, using G. Miller
as a genuine production recipient.

---

## 15. The new-page contract

`overtime.html` is a first-class MYB surface and owes every contract the other six do. Verify before
beta: mirrored CSP `<meta>` · `noindex` · `overtime-boot.js` (CSP blocks inline modules) · no inline
JS · `auth-policy.js` entry · `NAV_PAGES` entry (reviewer-gated during beta) · own stylesheet · shared
type / focus-ring / chip-radius tokens · page-CSS parity · card-header parity (h2, leading emoji) ·
service-worker precache · safe-notification page when notifications arrive · offline behaviour ·
analytics page id in **both** `usage-reporter.js` and the rules allowlist ·
`recordPageLatency('overtime')` · CSP test · visual baselines · axe · keyboard and focus · 390px
mobile · desktop.

Stay inside the existing design grammar. This is a roster tool, not an HR system.

Suggested baselines, kept few: `overtime-member-mobile-390` · `overtime-manager-mobile-390` ·
`overtime-manager-desktop-1280` · `overtime-closed-mobile-390`.

**Overtime must never enter Calendar bootstrap** — no imports, Firestore reads or Function calls
before Calendar's first useful roster paint. Any future Calendar due-strip loads after Calendar is
usable.

---

## 16. Tests

Organised by the failure, not by the function.

**The timetable** — valid and rejected Saturdays · every offset · GMT · BST · both DST transitions ·
a week straddling one · year boundary · leap year · retention date · creation refused after final
deadline · creation refused beyond `maxRosterYear`.

**Eligibility** — `!hidden && !managerOnly` · G. Miller in, H. Croft and every manager out, hidden
leavers out · future start dates · stable `rosterOrder` · Firestore-safe document ids · each rung's
selector produces its expected population against the real generated roster.

**Window creation** — dry-run and real derivation identical · deterministic id · duplicate creation
opens rather than rewrites · single batch · batch-bound guard · milestones frozen · no
`expectedCount` anywhere.

**Round trip** — for every answer mode including overnight custom: form → normalise → write shape →
read → render → resubmit, preserving semantic value, with an assertion that every schema key is
produced by a read. `paycalc-form-data.test.mjs` exists because ~70 lines produced four money-affecting
defects in four releases, every one a round-trip asymmetry. Same shape of data, same idiom.

**Concurrency** — identical retry succeeds without a revision *and updates `lastMutationId`* · stale
`ifRevision` with identical content succeeds · stale with differing content 409s · mutation id
persisted on head and revision · timeout reconciliation matches · an unrelated newer mutation gives
the generic conflict message, a known timed-out one gives the precise message · head and revision
never disagree.

**Derived history** — initial-cut-off revision selection · late derivation · changed-since-initial ·
several post-initial revisions · reverted exactly to the initial state · exact deadline boundaries
either side and on.

**Security** — reviewer reads · ordinary member direct Firestore read denied · Viewer denied ·
anonymous denied · every client write denied including admin · admin cannot impersonate another
submitter · `getMyOvertimeState` returns `[]` for a manager.

**Roster context** — Sunday · Christmas · RD · RDW · AL · absence · override · missing authoritative
data · month and year boundaries · a stored before/after boundary unchanged by a later roster edit.

**E2E** — G. Miller: nav, BETA banner, both tabs, real submit, update, closed history. H. Croft: nav,
Manager view, no personal form, **not-created rows**, submission visible, cannot edit. Ordinary member:
no nav, direct URL yields nothing. Viewer: no access. Adjacent overlapping weeks independently
selectable. A stale second tab does not overwrite.

**Accessibility** — semantic day groups with legends · first-error focus · associated validation
messages · status announced once · no colour-only state · keyboard-reachable tabs and filters ·
logical Manager grouping on mobile.

---

## 17. Retention

Forms stay available roughly three months — exactly **13 weeks after the week-ending Saturday**,
stored as `retentionUntil` at creation with a precise server-side local-time expiry, not an informal
phrase.

Both endpoints filter on it, so behaviour never depends on when the purge last ran (§9 explains why it
is not in the rules). The scheduled purge arrives later in beta and deletes recursively — revisions,
submission heads, participants, then the parent. **Firestore does not delete subcollections with their
parent.**

On the day the first beta window is created, add to `MAINTENANCE_CALENDAR.md`:

> **Overtime retention purge** — must be live before the first beta window reaches 13 weeks.
> Warning point: week 10.

---

## 18. Notifications (later beta)

Follow `.claude/rules/notifications.md` and `buildPushPayload`; never hand-write a payload.

Four messages: window opened · initial missing-form reminder · final missing-form reminder ·
submission confirmation ("received", never "allocated"). **Reminders go only to participants with no
submission head** — never to someone who submitted "unavailable" all week; they responded.

**Per-week tags** — `overtime-2026-09-05`, not a single `overtime`. Adjacent windows overlap, so one
stable tag would let one week's message replace another's. This deliberately departs from the
one-tag-per-feature convention and must be documented as an exception in that rules file when it
ships. Same-week messages *should* replace each other: a submission confirmation replacing a stale
missing-form reminder is the desired behaviour.

**Observability is required.** A silent scheduler failure is the same class as the missing window. The
Manager week view carries one line:

> Initial reminder run Mon 12:00 · 3 forms outstanding · 3 push targets attempted

Accurate wording — never "3 staff notified", because a successful push says nothing about a person
having seen it. Record run time, outstanding count, target count and send failures. One line in a view
someone already reads; not a dashboard.

---

## 19. Definition of done

**Rung A succeeds when** G. Miller can submit genuine availability, amend it, trust that it saved,
read previous real forms and use the Manager view; H. Croft can see immediately which upcoming weeks
have no window, open the right week, read real submitted availability, tell no-response from
unavailable, see current roster context, notice post-initial changes, and actually use it when
preparing the roster. And the system preserves every accepted revision, prevents silent overwrites,
enforces deadlines on server time, stays truthful when roster context is missing, keeps beta history
private, and refuses ordinary staff and the Viewer.

Plus one explicit acceptance check, because it is the failure nothing else catches: **an upcoming week
with no window visibly says NOT CREATED.**

**Rung B succeeds when** counts, awaiting lists and by-day grouping are legible with a real mix of
responders and non-responders, and the pilot reports whether seven answers a week is sustainable.

**Rung C is gated on** trusted Manager workflow · stable member form · reliable named-account access ·
working password recovery · reminders production-tested during beta · retention automation ready ·
ordinary-member E2E green · beta history still invisible · one genuine non-admin staff account proven
end to end on a real device.

---

## 20. What beta must answer, and what it cannot

**Ask after each real cycle:** does H. Croft work mostly by day? Does he need By person, or grade
filters, or a printed day list? Are the before/after options meaningful? Is roster context in the
right place? Are post-initial changes obvious enough? Is the revision drill-down useful or noise? Does
anyone want a note field? Does one form spanning both deadlines match how the roster is really built?
Is retained availability useful for short-notice cover? **Is anything still being copied out into
another document?** — that last one decides whether "Print this day" is worth more than any tab.

Do not guess these in architecture, and do not pre-build against the guesses.

**What beta cannot answer:** whether staff will submit trustworthy forms on time, every week. Rung A
cannot (one person), and rung B only indicates. Seven explicit answers are deliberate friction because
a genuine declaration matters — but friction is the product risk, and no amount of design removes it.
**Do not reduce it by silently guessing answers**; a pre-filled form invites a rubber stamp, and a
rubber-stamped availability declaration is worse than none. If real use shows the friction is too
high, add an explicit *Copy last week's answers* that lands as an unsaved draft requiring review and
Submit — never an automatic pre-fill, and never before beta has asked for it.

---

## 21. Final data flow

```
CANONICAL ROSTER DATA
        ↓  generated overtime-eligible members
MANAGER PLANNING HORIZON  ← makes a missing window visible
        ↓  weekly window created
FROZEN PARTICIPANT SNAPSHOT
        ↓  getMyOvertimeState
GENUINE SEVEN-DAY AVAILABILITY
        ↓  server-authoritative transaction
        ├── optimistic concurrency
        ├── mutation id
        ├── immutable revision
        └── materialised head
MANAGER LIVE VIEW
        ↓
HUMAN ROSTER PLANNING
        ↓
RELEASED ROSTER
        ↓
CALENDAR
```

No arrow runs backwards. Availability never writes the roster.
