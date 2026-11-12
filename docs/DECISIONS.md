# DECISIONS.md — what has already been decided, so it is not re-argued

*Created 8 Sep 2026, split out of `ROADMAP.md`. Not version-stamped; not a runtime asset.*

**Every entry here is CLOSED.** The roadmap answers *what should we build next*; this file answers
*what did we already decide, and why*, which is a different question with a different reader. It
exists because the expensive failure in a long-lived project is not forgetting an idea — it is
re-proposing one that was tried, measured or refused, and paying for the argument twice. Two entries
below were re-recommended by external reviewers who could not have known: the admin task navigator
had been built and removed on the owner's own judgement, and the Pay Calculator grouping had four
drafts and a measured prototype behind it.

**A closed decision may still carry a TRIGGER.** "Declined" here does not mean "never" — several
entries name the evidence that would reopen them. What it means is that the decision stands until
that evidence arrives, and that arguing it again without the evidence is re-work.

**If something here reopens, MOVE it back to `ROADMAP.md` rather than copying it.** Two live copies
of a decision is the drift the v19.97 history split was made to stop.

---

## Declined features

### Today / Next calendar strip — DECLINED
**Status:** Declined (owner decision, Sep 2026) · **Trigger to revisit:** staff actually asking "what am I doing today/next" faster than the grid answers it · **No work before the trigger**

Proposed by the v22 external review (its "best everyday-staff improvement"): a compact line above
the month grid — *Today · Late · 14:00–22:30 / Tomorrow: Rest* — tapping through to the day detail.

**Declined because the month view is the product.** Staff read this grid every day and are fluent
in it; today's cell is already highlighted, and a fluent reader gets "what am I doing today?" in
one glance at the thing they were already looking at. The strip would spend the app's most valuable
pixels permanently — pushing the grid down on a 375px phone — to save a glance nobody has reported
needing. No staff request exists, and the calendar's own surface should not be EASIER to add to
than WebCal or dark mode below, which both correctly wait for evidence; it is the screen with the
most to lose. The additions this app has reverted (beta chip, labelled bell row, display typeface)
were all "helpful" things nobody asked for.

A quieter cost, recorded so a revisit prices it in: the strip would be a second consumer of the
Calendar's knowledge-state decision (`CALENDAR_DATA.md` — never present the base roster as though
it were current), which is the invariant class behind previously shipped bugs. It must wait on the
same display gate as the grid or show its own skeleton — the feature is not even cheap.

### Pay Calculator — "More pay tools" grouping on phones — DECLINED
**Status:** Declined (owner decision, 3 Sep 2026) · **Trigger to revisit:** a staff report about the
tail of the Pay Calculator page — or, should card opens ever be counted for some other reason,
counts showing the HPP and back-pay cards are never opened. **Do not add that instrumentation to
test this idea**; a measurement system built around a problem nobody has reported is the same
speculation in a lab coat · **No work before the trigger**

Proposed by an external review and taken through four drafts and a measured prototype (Sep 2026):
below 1024px, hide the Holiday Pay Premium, Pay Rise Back Pay, Decimal Hours Converter and Move Your
Pay Data cards behind one quiet "More pay tools" line in the `.guide-footer-link` idiom, the cards
staying in the DOM with their own collapse state. Measured at 390×844 for a returning member: the
page goes from 3,484px to 3,189px (−8.5%) and desktop is byte-identical. The same measurement is
why it was declined: the four cards are **8.6%** of the page and the Hours card is **49.5%**, and the
saving sits below the take-home figure — past the answer the member came for.

**Declined because it hides two money features from the members who most need to find them.** The
HPP and back-pay card subtitles — *"Paid once a year on a January payslip — look for the green note
on that payslip"* — are the app teaching an entitlement, and for a member with no hours
entered yet they are the only route that asks nothing of them first: the result banners that would
promote HPP and back pay are gated on a stored estimate, which needs prior-year hours, so that
member gets no banner today and would get no card tomorrow. The Pay Calculator Guide explains both
in full — but a guide has to be OPENED, and somebody who has never heard of HPP has no reason to go
looking for it. (This said "the ONLY route" until 3 Sep 2026; an external review pointed out the guide
makes that literally untrue, and the precise version is the stronger argument.) That is the `paycalc-year-card.js` lesson — a control vanishing from the people who
need it, when they need it — repeated. It would also be unmeasurable, because card opens are not
counted. No staff request exists.

Two findings from the work stay true, recorded so a revisit does not pay for them twice. **Any
grouping must reveal before the `#payTransferCard` deep link scrolls**: with the cards hidden, the
transfer card's entire landing correction runs against `display: none` and the member lands at the
top of the page with nothing to explain why (the real e2e fails with a `TypeError` on a null box —
assert visibility before position). And `paycalc-app.js` sat at **1,900 of a 1,900-line ratchet**
when this was decided (the current figures: `coordinator-ratchet.test.mjs`) — the room a cap carries
for a fix was already spent, so the next change to that file, however small, had to move something
out first. **Do not make that move speculatively.** The seam should be drawn by the change that
needs it; a module carved today to hold three click handlers is a guess at where that
change will want its boundary, and the ratchet is doing exactly its job by waiting. When it comes,
the ready candidate is the cross-card navigation block (`_bannerViewCard` and the three link
wirings, ~20 lines, no calculations), named for what it is — `paycalc-card-navigation.js`, never for
the grouping that was not built. The transfer card's hash branch stays where it is; its
ResizeObserver landing correction is its own concern. If the tail is ever
revisited, start from grouping only the two gadgets (Decimal Hours Converter, Move Your Pay Data) —
nothing taught is lost, ~95px saved — and expect that not to be worth a module either. Better
still, ask a different question than "what can we hide?": **can the two utilities be made to look
less like major calculator sections — lighter headers, no chevron-card chrome — while HPP and back
pay keep their educational prominence?** Visual weight is the lever that costs no discovery.

The four cards were never one category, which is why the grouping felt logical and was
semantically wrong: the HPP and back-pay headers **teach an entitlement** all year, while the
converter's and the transfer card's headers only **identify a tool**. The principle to carry
forward is worth more than the 295px this set out to save: **a collapsed section is not unused
vertical space — ask what its collapsed state is communicating before hiding it.** It applies to
the Hours card too, which is 49.5% of the page and is NOT therefore a target: most of that height
is copy mapping each category to the words on a real payslip, and "where are the most pixels?" is
the wrong question. The right one is where staff spend effort for little value, and nothing has
shown that yet.

---

## Decisions taken — recorded so they are not re-raised

- **The month grid takes no pinch-zoom** (owner, 10 Nov 2026) · **Trigger to revisit: a member who
  needs to zoom the month and cannot.** The grid's `touch-action: pan-y` keeps a sideways swipe for
  changing month, so a pinch that STARTS on the grid does not zoom; a pinch anywhere else on the page
  does. Allowing it (`pan-y pinch-zoom`) needs a test on a real iPhone and a real Android phone first,
  for the gesture arbitration the code warns about, and was declined.

- **A payday counts as paid from 12:00** (owner, 10 Nov 2026 — kept) · **Trigger to revisit: payroll
  moving the time pay lands.** It is the same rule everywhere a payslip is "paid" or "current", so the
  whole-app check left it alone.

- **Notifications after a sign-out are re-saved by the Calendar alone** (owner, 10 Nov 2026) ·
  **Trigger to revisit: a member who signed in on another page reporting missed notifications.**
  Signing out removes the device's push record, and the next signed-in Calendar load saves it again.
  A sign-in on any other page does not, so the bell can read "on" with no record until the Calendar
  opens, and the app opens on the Calendar. Re-saving on every signed-in page would cost a call on
  every load (`getNotifState()` after `ensureFirebaseSession`).

- **A back-pay lump typed from the payslip carries no "fill in your hours" line** (owner, 10 Nov 2026
  — the July line, narrowed) · **Trigger to revisit: none expected.** Hours cannot change a figure
  copied from the payslip, so the banner's second line shows only for a computed lump
  (`paycalc-money-banner.js`).

- **Two workflow questions, both left as they are** (owner, 10 Nov 2026) · **Trigger to revisit: a
  branch's deploy holding up a release from `main`, or an indexes-only change becoming routine.** A
  manual deploy run from a branch still shares its workflow's queue with `main`, because the groups are
  per-workflow and ref-independent on purpose (`deploy-functions.yml`, `deploy-rules.yml`); and a change
  to `firestore.indexes.json` alone still needs a version bump.

- **Leave over rest-day working is free, whatever kind** (owner, 10 Nov 2026 — "Free, like plain
  RDW") · **Trigger to revisit: payroll charging a day of leave over a rest-day Training, Meeting or
  Spare record.** Leave booked across a base rest day holding RDW, an Other day (Training, Meeting … —
  "TRG RDW") or a Spare turn costs no entitlement; only a recorded swap (`shift`) on a rest day does
  (VAL-AL-001). The base roster is the witness, because once leave replaces the record only its type
  survives (`isContractedWorkOverride`, `override-utils.js`). Neither booking path asks about such a
  day: it is settled, and free. The roster review treats the roster's leave over one as it treats leave
  over an RDW — as the rest day it costs nothing on. Not changed by it: an ABSENCE over such a day
  still shows on the Calendar.

- **The roster upload offers next week from Thursday** (owner, 10 Nov 2026; the Saturday case settled
  by the lead the same day) · **Trigger to revisit: the roster office changing the day it releases
  the roster.** The week-ending box defaults by London date: Sunday to Wednesday to the week in
  progress, Thursday and Friday to the Saturday after next (the Thursday release's week), and a
  Saturday to the next Saturday, so Thursday to the following Wednesday all offer one week
  (`defaultWeekEnding`, `roster-alignment.js`). A whole week out is the one misplacement the day-drift
  checks cannot see; where its heading can be read, the sheet's own printed week now refuses one
  (KNOWN_LIMITATIONS.md → "The sheet's own week is checked only where its heading can be read").

- **A roster import never pre-ticks 25 or 26 December** (owner, 10 Nov 2026) · **Trigger to revisit:
  the Christmas leave rule changing (`christmas-leave.js`).** Those rows start unticked with a note
  that the app's Christmas leave decides the day, ask no swapped-day question, and can still be ticked
  on purpose (`isChristmasClosureDate`, `roster-review-states.js`).

- **When every Monday-to-Saturday cell of an imported row is unread, its Sunday is unread too** (a
  default decided in the whole-app fix, 10 Nov 2026, not an owner decision) · **Trigger to revisit: a
  live Dispatch import on which the extra Sunday questions prove tiresome** (KNOWN_LIMITATIONS.md →
  "Worth watching on a live Dispatch import"). Such a Sunday is a question, never pre-ticked as a rest
  day (`computeCellStates`), because a member printed on a second sheet works most of the week
  elsewhere.

- **The leave panel labels a balance it has not checked yet** (a default decided in the whole-app fix,
  10 Nov 2026, not an owner decision) · **Trigger to revisit: a report that the label is noise on a
  good signal, or a case for a maximum age.** The saved balance still paints at once and is kept when a
  refresh fails, but until the server answers it reads "Saved copy — checking for changes…", and
  "Saved copy — couldn't check for changes" if the check fails — the month grid's words
  (`CALENDAR_DATA.md` 18). No age limit and no date are shown.

- **Card-title icon tiles — BUILT, THEN REMOVED; a chosen control wears the page's colour instead**
  (owner, 3 Nov 2026 — "Use screenshots and choose the best aesthetic solution. Still unsure whether
  the tile colour is an improvement too"; v25.16) · **Trigger to revisit: a case for colour in the
  cards that the side-by-side screenshots behind this entry do not already answer — not "the cards
  look plain".** v25.14 sat every card title's emoji on a 28px tile in a tint of the page's colour, to
  carry that colour below the header. Compared side by side with no tile, at phone width on five
  pages, it lost. It was the busiest thing on a calm page at ten-plus tiles a screen. It repeated the
  badge's colour and said nothing the badge did not. It made every title line taller, and it tipped
  Pay's HPP title onto two lines at 375px. v25.15 also had to fix it hanging onto the line beneath.
  The colour went to where it MEANS something: whatever you have chosen. Before, a chosen tab was
  navy on most pages, raspberry on one Trains row and a gold tint on Links, so one screen could show
  two colours for one idea. Navy is kept for buttons that do something. Choices with their own
  meaning (shift types, yes and no) keep their own colours. The rule and its exceptions are
  `.claude/rules/css-tokens.md` → "Whatever you have chosen wears the page's colour", enforced by
  `page-identity-parity.test.mjs`.

- **The App Speed card answers live questions only** (owner, 25 Oct 2026 — choosing the App Speed
  review's recommendation, "Do it all in the order of work"; v24.98) · **Trigger to revisit: a new
  latency question that needs a reading the card no longer takes — rebuild that instrument then, its
  writes and its card block in one release.** "Why some are slower" was about two thirds of the card and
  answered the sign-in speed investigation `LATENCY.md` closed on 19 Sep 2026. It was TRIMMED to what
  still has a question behind it — the stored copy before the sign-in check, the wait after a release,
  and Usable by app version and by how the page was opened — rather than folded behind a "Details"
  control, because a folded block still costs every open its samples. The boot stages, the start
  ladder, the saved-copy/server split, the retired fast path and the worker's file count went WITH their
  writes: write-only telemetry is the state the worker count sat in for six releases, and nobody could
  see it. The connection comparisons left the CARD only — the connection class is one part of every
  sample's key (`perfSampleKey`), not a write of its own, so it is still recorded and nothing reads
  it. It does multiply the keys, so dropping it is the cheapest cure if the record ever nears full. In
  the same decision the month's record stopped being indexed and the card began stating how full it
  is (KNOWN_LIMITATIONS.md).

- **The Trains page is every member's** (owner, 20 Oct 2026 — "make the trains page live for
  everyone"; v24.81) **— and the station PIN's** (owner, 22 Oct 2026 — "the station pin staff should be
  able to view the trains page"; v24.84) · **Trigger to revisit: the page showing anything that is
  somebody's own — a member's shifts, leave or pay.** It was an admin preview from v24.71 while it was
  shaped. The v24.81 trigger ("staff on the PIN asking for it") is what fired: the people customers ask
  about the timetable are at the station, often on its shared PC. The PIN is admitted because the page
  reads nothing — the timetable is public — so a station that keeps its PIN there can reach nothing it
  could not already. That is the whole argument, and it stops holding the moment the page shows a
  member's own data; "Your shift" would need a sign-in. How: `staffPin: true` in `PAGE_POLICIES`, and
  `holdsStaffPin` asked before the sign-in (AUTH_AND_SESSIONS.md invariant 24). Every other protected
  page still signs the PIN out on arrival. Narrowing the member side again is one line in
  `auth-policy.js` and one flag in `nav-panel.js`, which `page-contract-parity.test.mjs` requires to
  move together.

- **The documents keep their stored permanent link as a FALLBACK** (owner, 7 Oct 2026) · **Trigger: a
  leaked Huddle, Circular or Newsletter link, or a sustained run of `getDocumentUrl` failures that makes
  the fallback the usual path rather than the exception.** The October 2026 review asked to stop storing
  the permanent `storageUrl` and to re-mint a signed link inside the open handler. Three options were put:
  keep the fallback, stop storing it for new uploads only, or remove it and rotate every file. The owner
  chose to keep it. The 15-minute signed link is still what a member normally opens (v24.19); the
  stored one is used only when that cannot be fetched — offline, a timeout, a 503 — and removing it
  would make a document simply not open at those moments, while minting at click time spends the tap
  and gets the tab pop-up-blocked. EXC-007 in ARCHITECTURE.md stays open on that basis.
  **Rotate the links once now** (owner, 12 Nov 2026). Built as a button — Operations → Document links —
  rather than a one-off script, because nothing in a session can reach production and the owner can
  press a button; it stays, so a leaked link is one press from dead. It keeps the fallback: a rotation
  gives each record a NEW permanent link, it does not take the stored link away.

- **The staff PIN session keeps NO server-side time limit** (owner, 7 Oct 2026) · **Trigger: a PIN
  tab found open on a device that should not have it, or a PIN rotation that has to chase sessions.**
  The October 2026 production review proposed an `auth_time` ceiling in `isCalendarViewer`, because
  the PIN session lives in sessionStorage and browsers bring that back on a session restore, so a tab
  can outlive the day it was opened. The owner chose to leave it as it is. Rotating the PIN and
  revoking the viewer's tokens (RECOVERY_RUNBOOK.md) remains the way to end every PIN session at once.

- **Shared office PCs are not treated as a shared-browser risk** (owner fact, 7 Oct 2026) · **Trigger:
  a shared Windows login, a kiosk profile, or any PC where two people use one browser profile.** The
  same review found that the Firestore cache in IndexedDB, and the leave-balance memos, stay on a
  device after sign-out or a PIN session, and proposed a memory-only cache for PIN viewers and a wipe
  on sign-out. The owner's answer: *"We all sign in individually into windows on shared PCs"* — so
  each colleague has their own Windows profile and therefore their own browser storage, and the
  residue is that person's own. The proposal changes `persistentLocalCache`, an architecture
  decision, and buys nothing under that arrangement.

- **The Pay Calculator's "other payslip adjustment" stays TAXED, and expense refunds stay out of it**
  (owner, 7 Oct 2026). The guide used to suggest an expense belonged there, but the box is added to
  pay and taxed. Rather than add a "not taxed" option, the guide and the row now say it is taxed like
  pay and that expense refunds should be left out.

- **The `push` run being cancelled when the PR run starts — the DESIGN is right, the RACE is now
  proven, and the question is OPEN** (9 Sep 2026) · **Trigger: FIRED, same day — see below. The open
  question is whether to make the preference deterministic, not whether one suite per branch is
  correct.** Every PR shows `Tests [push]: cancelled` beside `Tests [pull_request]: success`, and it
  reads like a fault. It is the intended outcome: both events collide in one concurrency group so a
  branch carries one suite rather than two, and the survivor *should* be the `pull_request` run —
  which checks out the synthetic MERGE COMMIT, i.e. what merging would actually produce, where the
  `push` run only tests the branch head. When `main` has moved under an open PR those are different
  trees and the merge-result run is strictly the better evidence. **This was re-raised on 9 Sep 2026
  as "how do we fix this", which is the whole reason for this row** — the argument existed, but only
  inside `.github/workflows/e2e.yml`, where somebody watching CI is not looking.

  **Measured that day, and then immediately falsified — both halves are the record.** A sweep of the
  last 63 `Tests` runs (38 distinct commits) found **zero** wrong-way races: the six cancelled
  `pull_request` runs were all ordinary supersession by a newer push to the same PR. Cancellation
  usually lands within 0.1–0.8 min. **Then the very next pull request — #1431, the one adding this
  row — produced one.** The `pull_request` run started 11:49:42 and was cancelled; the `push` run
  for the same commit started **11:53:30** and survived. Nothing was lost in that instance (a
  docs-only change whose full gate had been run locally on the rebased tree), but the merge-result
  evidence was destroyed and only branch-head evidence remained.

  **The falsification changes one load-bearing assumption.** `e2e.yml` frames the exposure as "a base
  that moved in the *seconds* between two runs of the same commit". The observed gap was **228
  seconds** — a force-push after a rebase, where the push event is evaluated over the whole pushed
  range and is scheduled well after the PR event. Minutes, not seconds, is a window in which `main`
  genuinely moves; it moved three times on 9 Sep 2026 alone.

  **It is now COUNTED rather than noticed** — and since 10 Nov 2026 FILED: until then the detector had
  no repository for its `gh issue` calls and could file nothing. `.github/workflows/race-detector.yml` (9 Sep 2026) runs
  hourly and reports into one deduped issue, distinguishing the two kinds: *consequential* (a
  branch-head run survived, so a merge would rest on it) from *superseded* (the push run was killed
  by a later push too, so nothing completed and nobody was hurt). Its own first cut required the
  push run to have settled and therefore found NOTHING on the day of the race — both real instances
  were the second kind — which is the silence it exists to end, so it reports both. Running it over
  that day's real data found **two** instances, not the one that was noticed by eye.

  **What is NOT in doubt:** one suite per branch, and the deploy workflow's own gate as the net. What
  is open is the race. The three deterministic options and their costs, none yet taken — drop the
  `push` trigger (loses pre-PR CI), a guard job querying for an open PR (an API call on every push),
  split the groups (doubles CI on every push to an open PR, which is what the group was added to
  stop). **The full argument, including why the key is `head_ref || ref_name` and why the obvious
  `github.ref` recipe silently does nothing, lives in `e2e.yml` beside the config.**

- **WebKit stays OUT of the deploy gate — LEAVE IT** (owner, 8 Sep 2026) · **Trigger to revisit: a
  Safari-only regression actually reaching production, or the work-phone install being permitted (a
  second engine running the INSTALLED app changes the exposure, not just the browser mix).** The
  question was re-opened the same day the platform premise was corrected to *two platforms served
  equally* — Chromium gates every release (`npm run check`, the Chromium smoke suite, the deployed-CSP
  proof) and `npm run test:webkit` runs on branches only, so equal service sits behind an unequal
  gate. The exposure is real but NARROW: every normal change reaches main through a branch, where
  WebKit does run, so what ships un-gated on Safari is a direct-to-main push or a manual dispatch.
  Against that, a full WebKit run took 13.2 minutes when last timed, against a deploy of roughly
  eleven and a half — **so gating on it roughly doubles time-to-live for every release, an emergency
  fix included**, which is the cost the owner weighed and declined. The subset option (gate on part
  of the suite) was available and not taken: a hand-picked list is the shape this repo keeps finding
  stale. **Nothing here says Safari matters less** — the platform rule in CLAUDE.md is unchanged and
  both engines stay first class; this is a decision about where the check runs, not about whether it
  matters.

- **The Hosting deploy's gate runs as parallel jobs** (owner, 10 Nov 2026). The tests and the upload
  were one job, so the two Chrome projects ran back to back: v25.68's and v25.69's deploys took 38m24s
  and 37m10s of a 40-minute limit, and #1737 doubled the limit to 80 so the next release could not be
  cut off. The owner then chose the cure over the margin: `check`, `smoke` (one job per Playwright
  project) and `csp` run side by side and `deploy` waits for all of them — the split `e2e.yml`'s
  pull-request checks have used since 3 Nov 2026, where each half takes 16 to 18 minutes — so a
  release waits for the slowest job, not the sum. **What it costs:** every job installs its own
  dependencies (runner minutes, free on a public repository), and a refused re-run now spends the
  gate's time before it is refused. **What keeps it the same gate is wiring, and
  `workflow-hygiene.test.mjs` holds every wire:** the deploy needs each gate job, the matrix names
  exactly the config's projects, the failure reporter needs every job (a gate job that runs out of
  time leaves the deploy skipped, which nothing else would report), and only the deploy job can sign
  in to Google. When a half outgrows its 40 minutes, shard within the project, as `e2e.yml`'s webkit
  job does. The account is the comment at the top of `deploy-hosting.yml`'s `jobs:`.

- **The Huddle print notice keeps `:has()` — DECLINED** (external review, 8 Sep 2026). Replacing
  `body:has(#huddleViewer.visible)` with a body-state class was proposed on portability grounds. The
  app already leans on `:has()` in several stylesheets, and the other uses fail *worse*: an unsupported
  engine would leave a selected back-pay/HPP mode option and a ticked Links objective looking
  unselected, which is a wrong answer on screen, against one missing explanatory sentence here — the
  print protection itself is a plain `#huddleViewer { display: none }` and needs no `:has()` at all.
  A class would also add a third piece of open/closed state to the app's one hand-rolled overlay
  lifecycle, which has already shipped two bugs caused by exactly that duplication. The reasoning
  lives beside the rule in `index.css`; this row exists so the proposal is not re-made.

- **Pay-data transfer notice — DISMISSED as drafted** (owner, 31 Jul 2026). A one-time notice
  pointing staff at the "💾 Move Your Pay Data" card was drafted and rejected in that form. **Do not
  simply re-raise it**: the deferral reason that used to sit here (the `password-2026` campaign) is
  gone, so "the blocker has cleared" is not a reason to write it. If it returns it needs a different
  shape, not a rescheduled one. Nobody loses pay data by there being no notice — the card exists with
  a working deep link (`paycalc.html#payTransferCard`), and figures are lost only by switching
  address and expecting them to follow. There is no deadline.
  **On iPhones that last premise does not hold** (iPhone audit, 7 Nov 2026): Safari clears a tab's
  storage after a week away, and the Home Screen app keeps a store of its own, so figures go missing
  with no change of address (KNOWN_LIMITATIONS → "iPhones keep two separate copies…"). The notice
  stays dismissed. What answered it instead is the "different shape" this entry asks for: contextual
  lines where the moment arises — the install wording, the transfer card, and an emptied calculator
  pointing at Restore (owner: "Do all of your suggestions", 7 Nov 2026).
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
- **Links compare on a phone — self-labelling cells: DECLINED** (v22.77, external review). The
  proposal was to give each compare cell its own day label so the grid survives a narrow screen.
  It is the wrong device for the job rather than a layout to fix: a 24x7 grid of two designs is a
  desk task, three named designers do it, and there is no reported use of compare mode on a phone.
  Buying it would cost the coordinator complexity and every compare cell a second label to keep in
  step. The narrow case is already served — the columns stack below 1024px and each scrolls — and
  what the review was reaching for (finding the changed lines quickly) is answered instead by the
  **only-the-lines-that-differ** view shipped in the same release, which helps on every width.
  Reopen only if somebody reports actually using it on a phone.
- **Links sticky save bar — density pass: DECLINED** (v22.77, external review). Nothing is reported
  wrong with it, it has already had a tuning pass, and "denser" is not a defect. This is recorded
  rather than left on a list because it has now been deferred twice; a third deferral would be a
  decision nobody is making.
- **Profile photo / avatar — removed** at v12.22; the nav footer shows initials on a stable per-name
  colour. Full restoration spec: `ROADMAP_HISTORY.md`.
- **Cultural calendar — removed** at v13.23 (annual maintenance burden + GDPR Article 9 exposure +
  no observed usage). Full restoration spec and the erasure requirement: `ROADMAP_HISTORY.md`.
- **Password security — the original five-stage plan is superseded** by the "C-lite" design in
  `PASSWORD_DESIGN.md`, which did not wait on email verification. The original staged text is kept in
  `ROADMAP_HISTORY.md` because its reasoning is still sound; do not plan from it.
- **GDPR:** staff shift data is personal data. If the governance gate is answered "official", data
  controller status and retention policies need documenting — see that gate.
- ~~**The Calendar PROVISIONAL FAST PATH stays — KEEP, owner decision, 19 Sep 2026.**~~ **SUPERSEDED
  26 Sep 2026 — see the next entry; its own reopening condition was met.** v22.97's
  provisional paint shows a returning member their own cached roster while `accounts:lookup` is
  still in flight. `readyProvisional` (v23.70) measured how often it actually fires: **1 open in
  roughly 800 eligible**, and on the strength of that an external review asked whether it could
  simply be deleted. The answer is no, and the reasoning is recorded here precisely so the low
  number does not reopen it every time somebody reads the telemetry.

  **Three reasons, and the first is the one that decided it.** `revokeProvisional` (removed 26 Sep 2026) was a SECURITY
  path — it takes a roster back off screen when an identity does not confirm — so deleting this is
  not removing an optimisation, it is removing a guard and the branch it protects. The evidence is
  ONE month, and `LATENCY.md` declined a 4.6–52 ms optimisation for want of evidence; removing a
  revoke path on thinner evidence than that would be inconsistent in the expensive direction. And
  the population it serves is small **by construction rather than by accident** — a member on their
  own device with their own name selected, which is exactly who the app should be fastest for even
  when that is rare.

  **Deleting is not free either**, which is the half the "can this be deleted?" framing tends to
  drop: it costs a release, a version, and a fresh regression surface in the access module, where a
  mistake is worst. Footprint for anyone weighing it again: ~41 references across
  `calendar-access.js`, `calendar-overrides.js` and `calendar-app.js`, plus the telemetry that
  measures it.

  **What would reopen it:** evidence that the path is WRONG, not merely rare — a refusal that should
  have been a grant, or a grant that should have been a refusal. Rarity is settled and is not a
  reason to ask again.
- **The provisional paint — RETIRED, owner decision, 26 Sep 2026.** The entry above kept it unless
  it was shown to be WRONG, and in one week it was, twice: a member-scoped cache read marked the
  months known for EVERYONE (a colleague could draw with their leave and absence missing), and the
  one-shot `onGranted` was spent while access was still `none` (the forced set-password step and the
  claim sweep never ran after a Calendar sign-in). And it could not have worked: `getDocsFromCache`
  queues behind Firebase Auth initialisation, which for a stored user IS the `accounts:lookup` round
  trip the paint existed to overtake (`LATENCY.md` → THE CLOSING READ), which is why it fired on about
  1 open in 800. So the guard it carried guarded a branch that almost never ran and could not win.
  Removed: `decideProvisionalAccess`, the provisional grant/revoke, `setOverrideAccess`'s member
  scope, the scope-lift re-read, and the `readyProvisional` WRITE (historic months still render on
  the Speed card). A named boot now grants once, after the identity confirms, unscoped.

  **What would reopen it:** an APP-OWNED snapshot of the member's own roster — written by the app on
  a confirmed grant and read without going through Firestore, so it is not queued behind Auth. That
  is the only shape that can actually beat the round trip, and its cost has to be weighed first: a
  copy of somebody's shifts, leave and absence sitting in plain storage on a SHARED device, outliving
  the session that earned it, needing its own clearing on sign-out and leaver. Not a latency tweak —
  an access-and-privacy decision, the same as the one this retires.

- **The own-roster copy — APPROVED, owner decision, 5 Oct 2026 (v24.59).** Reopened on the one shape
  above. The access-and-privacy question was answered by the owner directly: *"The roster is not
  private information. It is available to the whole business."* So a returning member's own months
  are kept in plain storage (`calendar-snapshot.js`) and painted the moment the Calendar opens,
  labelled "Checking for changes…", while the identity is confirmed; the live data replaces them as
  each month settles. What keeps it from repeating either defect of the provisional paint: it is NOT
  a grant (no override read opens and the one-shot `onGranted` is not spent before the decision), and
  it never touches `rosterOverridesCache` or the knowledge states, so it cannot mark a month known
  for anybody. The privacy costs the entry above named are each answered: own rows only; deleted on
  every sign-out, on session expiry, on a PIN or failed grant, on access loss and for any other
  member; never shown to the PIN or in Team View; 14 days at most, a few months around today.
  **What would reopen it:** evidence that it was shown to somebody other than the member it belongs
  to, or a reason a member's own shifts should no longer be on their own device.

---

## The dropdowns that stay native (8 Sep 2026, v23.33 — completed and enforced v23.38)

`select-sheet.js` replaced the OS popup everywhere a reader reads a list — the Calendar's member
picker, Admin's member select (`#fieldMember`) and its month filter, the pay-period selector and the
rest of the calculator's fields, and the Links saved-setups picker. Some were left alone on purpose,
so that "why is this one different?" has an answer:

- **`#otIdentityMember` (Overtime).** It is `disabled` and carries exactly one option — the signed-in
  member — because, as its own comment says, "there is genuinely nobody else to pick". It never opens
  a popup at all, so there is no OS surface to replace; enhancing it would swap a disabled field for
  a disabled button and change nothing a reader sees.
- **`#monthJumpMonth` / `#monthJumpYear` (Calendar month jump).** These live INSIDE an already-open
  lightbox. A picker sheet over a dialog is a second modal layer, and the lists are 12 months and a
  handful of years — short, ordered and familiar, which is the one case a native popup handles well.
- **`#alMember` / `#sickMember` (Admin's Annual Leave and Absence cards).** Hidden value holders the
  save reads, not controls — the member is chosen once, in the top bar. They were enhanced from v23.33
  and reverted at v23.74: the enhanced copy was a second, operable member picker, so a card could
  save leave against one member under another's name.

**The trigger that would reopen either:** a report that the month-jump selects look wrong on a phone
(the same report that started this), or the Overtime identity bar becoming a real choice — which it
would, the moment a manager can answer on somebody else's behalf.

**Two more were not decisions at all — they were misses** (v23.38). `#rosterType` on Operations was
in the markup and simply not in the list; `#acctGradeFilter` is built in JavaScript after two
Firestore reads, so an id in that list would have been skipped silently. Both are now enhanced, and
the reason they went unnoticed for a release is worth keeping: **a missed select is invisible to
every lane the repo has.** The closed control looks identical, the popup is the platform's, and
Playwright's `selectOption` drives both — so the e2e suite, the visual baselines and the axe gate
are all equally green either way. The exclusions above are therefore an EXEMPTION TABLE in
`select-sheet-parity.test.mjs` rather than prose alone: adding an id there is how the decision gets
taken, and the alternative was taking it by forgetting.

### What a wider scan then found (v23.40)

The guard shipped looking in two places — `<select id>` in served HTML, and modules calling
`createElement` — and a `<select>` reaches a reader from a third: **a JS template literal**. Two
families were invisible to it, and neither is minor:

- **`#loginGrade` / `#loginName` — the sign-in cascade. DECIDED 9 Sep 2026 (external review) and
  now ENHANCED**; recorded at first as an open owner decision because it was the strongest remaining
  candidate in the app: a grade picker that enables a
  roster-length name list, the FIRST dropdown any member touches, rendered on all six protected
  pages plus the Calendar's front door. It is also the highest-blast-radius change available —
  `e2e/auth.spec.js` drives it on every one of those surfaces — which is why it was recorded rather
  than converted in passing.
- **`.gen-slot-time` (Links generator targets, one per shift slot).** Declared native: a dense table
  of times a designer sets in a run, not fields read one at a time. Replacing every cell of a table
  with a sheet trigger is a design question about tables, not a mechanical conversion. Designer-only
  surface, so nothing a member sees.

The second hole was quieter and is the one to remember: the runtime half asked whether a MODULE
calls `enhanceSelect` anywhere, not whether THIS select is enhanced. `links-generator-targets.js`
calls it for its saved-setups picker, so its nineteen slot times were reported as covered by a
module that does enhance — just not them. **A guard whose unit is coarser than the thing it guards
reports the thing as guarded.**

The same pass added the CSS half, which found two live defects rather than undeclared decisions —
`#fieldMember:disabled` styling the invisible select while a non-admin's visible trigger took the
generic grey, and `filterSelect.focus()` sending a keyboard user to a 1px `aria-hidden` element.
Both were introduced BY an enhancement, in the commit that made it: the call site did not change,
so nothing drew the eye to it. That is now two contracts — an id rule needs a `#<id>Trigger`
counterpart, and nothing may focus an enhanced select.

---

## Tooltips are removed, not rebuilt (9 Sep 2026, v23.50)

An audit of every surface the OS still drew found 47 `title` attributes. A `title` is a hover
tooltip: the platform's font, the platform's delay, the platform's box — and **nothing at all on a
touch screen**, which is where most of the staff are. So the question was never "how do we restyle
these" but "what does a phone user see instead", and the answer differed by what each one was for:

- **30 duplicated an `aria-label` on a button** ("Tips for Saved Changes", "Previous week", the
  header logo's "Back to calendar"). Deleted. The accessible name is the accessibility route; the
  tooltip added an OS surface for desktop users and nothing for anyone else.
- **9 sat on chips whose visible text already said it** ("AL left: 12", a count beside the card's
  own title, a tax year inside a card called Year to Date). Deleted.
- **A handful explained a DISABLED state** — why the Sunday pills are grey, why the manual back-pay
  option is unavailable — and those were the only ones with real value, and the only ones a phone
  user was actively missing. Each became a line in the row (`.sunday-note` in the week grid,
  `.bp-mode-why` under the option; the roster review's Sunday note already worked this way and its
  own comment argued the point). The Links totals cells got a legend line for the same reason.

**Not adopted: an app-drawn tooltip component.** The Calendar has one (`initCalendarTooltip`) and it
is deliberately a no-op on coarse pointers — a tooltip is a hover idiom, and building a better hover
surface would have polished the one platform that was never the problem. Where information matters it
belongs in the row, the `?` panel, or the day panel, which is the app's existing ladder
(Discover → Understand → Act → Deep dive).

## Safari's strong-password button stays (10 Sep 2026, v23.51)

The v23.51 re-audit suppressed three OS buttons inside the password field — Edge's `::-ms-reveal`
and `::-ms-clear`, Safari's `::-webkit-credentials-auto-fill-button` — because all three land in the
corner `.login-pw-toggle` already occupies and duplicate a control the app draws. The obvious fourth,
`::-webkit-strong-password-auto-fill-button`, is deliberately **left alone**, and it is worth
recording so the list is not "completed" later by someone tidying it.

The rule v23.50 established is *the OS draws nothing the app can draw*. That is a statement about
**chrome**, not about features. A reveal button duplicates the app's Show/Hide; a credentials key
duplicates a route the member already has. The strong-password overlay offers something the app has
no alternative to — a keychain-generated password — so suppressing it would remove a security
affordance and put nothing in its place, which is the opposite of what the rule is for.

The same distinction settles autofill, which the guard's own header got wrong on the first pass:
**offering** a saved password is the platform's job and is left alone (on iOS it is the keyboard's
QuickType bar, which no page can style anyway); **repainting the app's own field** to say so is not,
and is covered by contract 10.

**Not adopted: hiding the OS buttons by widening the field's padding instead.** The login field
already reserves 62px on the right for `.login-pw-toggle`; making room for a second, engine-specific
button would mean a different reserve per engine, measured on hardware this repo cannot test on.

`native-surface-parity.test.mjs` fails a `title` attribute anywhere served, so the next one has to be
argued for rather than typed.

## The oldest iOS supported is 16.4 (owner, 7 Nov 2026)

Settled by the iPhone audit of 7 Nov 2026, which found the app working everywhere from iOS 16.4 and
degrading below it: the 114 `color-mix()` rules (Safari 16.2) drop their colours on 16.1 and earlier
— the Links heat map's busiest hours go white on white — and below 15.4 `:has()` and `Object.hasOwn`
are missing too (the latter breaks Operations' App Speed card). 16.4 is also where Web Push for an
installed app begins, so it is the first version on which every feature of the app exists. The
phones that stop short of it are the iPhone 6s, 7 and first-generation SE, whose last iOS is 15.8.

**What it means in practice:** below 16.4 nothing is fixed and no fallback is added; anything newer
than Safari 16.4 must still be feature-detected, as everything is today. A report from an older
iPhone is answered with this entry rather than a patch.

**What would reopen it:** a member of staff who cannot replace a phone below 16.4 and depends on the
app — that is an owner conversation, not a code one.

## The New link pack's PDFs open in the app, drawn by PDF.js (owner, 10 Nov 2026)

Reported by the owner: "The pdfs on the new links page don't have a close button like the huddle pdf
does. This is particularly an issue on iphone." The pack is served by the GitHub Pages mirror, so for
an app installed from that address the files are inside the app's own scope, and iOS opens an
in-scope link in the app's window — which on an iPhone has no Back and no toolbar. The Huddle escapes
only because its file is on Firebase Storage, outside every install's scope, where iOS gives it its own
viewer with a Done button. A redirect cannot borrow that: iOS sends a navigation that returns to the
scope back into the app's window.

**Two fixes were put to the owner:** draw the PDFs in the app (`pdf-viewer.js`, a panel with a ✕,
PDF.js vendored in `pdfjs/`), or serve the pack from Firebase as well and link each address to the
other so every phone used its own viewer. **The owner chose the first.** The second would have undone
two deliberate rules — Firebase serves nothing under `docs/` and no PDF at all (firebase.json `ignore`,
held by hosting-ignore-parity.test.mjs) — and made every pack-only update need an app deploy, and its
one critical behaviour could not be tested off a real phone. The viewer works the same on every phone
and both addresses, and CI drives it in Chromium and WebKit.

**What it costs, knowingly:** a new runtime library (about 1.8 MB, fetched only when a file is first
opened, never precached), and the phone's own PDF tools — printing and sharing — are one step away, on
"Open the PDF on its own", which the viewer offers only where that cannot strand the reader
(`canOpenOutside`). On an iPhone installed from the mirror the offer is withheld, so a file cannot be
printed from there; the canonical address, where the install notice already sends staff, can.

**What would reopen it:** the pack moving to a host outside every install's scope, at which point the
phone's own viewer is available everywhere without a library; or PDF.js proving too heavy for the
oldest phones staff carry.

## The Calendar's state: one home per question, in four steps — and what was left on purpose (owner, 10–11 Nov 2026)

The three Calendar bugs fixed in early November 2026 had one shape: the page's idea of the situation
had fallen out of step with what had happened, in a place no rule covered. Asked whether that
complexity could be fixed, the answer was "partly". An offline-first Calendar with two ways in, whose
answers arrive in any order, has those states whatever the code looks like. What could go was each
question being answered in several places, each in its own words. Four releases, each its own, gave
each question one home:

| Step | The question | Its one home |
|---|---|---|
| 1 (v25.72) | Is this read's answer still wanted? | the read ticket, `calendar-overrides.js` |
| 2 (v25.74) | Is Calendar access held? | `calendar-access-state.js` |
| 3 (v25.75) | May the page draw now, and what does that draw owe? | `calendar-redraw.js` |
| 4 (v25.76) | (the leftovers) | each gate's own name for the access write, removed |

The rules each step leaves are `.claude/rules/calendar.md`, the invariants `CALENDAR_DATA.md` 20–21,
and the reasoning each module's header. **This entry records only what was weighed and NOT done**, so
it is not proposed again as unfinished business:

- **The lock card does not listen to the access state.** It could: `calendar-access.js` would hear a
  shut and put the card up itself, and both lost-access hooks (`setOverrideAccessLostHandler`, the
  first load's `onAccessLost`) would go. Today the card goes up AFTER everything that follows a loss
  has been told. As a listener it would go up among them, in module-loading order — an order the
  state promises nobody — on the one path where a mistake leaves a roster on screen.
- **A grant keeps two hooks**, `onGranted` (once) and `onEveryGrant`. The page could tell a first
  grant from a later one itself since step 3 (`redraw.reach('workspace')`). But "the workspace is
  built once" would then rest on the page instead of on the access layer, and about half of
  `calendar-access.test.mjs` is written against the two hooks: it would be rewritten to prove nothing
  new.
- **The first load still takes a repaint callback for each surface** and chooses between them,
  although the page now hands it the same function twice and the scheduler chooses again. Both read
  one fact, so the double choice cannot disagree; `calendar-initial-fetch.js` is the most delicate
  module the Calendar has, and its tests drive exactly that interface, one callback at a time.
- **Each gate keeps its READ name** (`hasOverrideAccess`, `hasDocumentAccess`). The app uses both,
  and they are where a narrower rule for one gate would go. Only the WRITE names were removed: a
  second name for a write misleads about its reach, and a second name for a read does not.
- **`owed()` stays**, though only tests read it. It is the scheduler's read-only account of what it
  is holding; without it the reason a repaint is held could be read by nobody.
- **Three guards that no test fails without stay, recorded as insurance:** the month read's early
  return while locked (it says so where it stands), and the every-grant hook's stage check and the
  "usable" timing's surface check (`.claude/rules/calendar.md`, pinned from the source).

**What would reopen any of these:** the Calendar's access or first-load code being changed for a
reason of its own, when its tests are being rewritten anyway. Not tidiness.

## The 11 November 2026 external review: what was taken up, and what was not (owner, 11 Nov 2026)

An external review of v25.77 found no new confirmed bugs in the checks it ran, and put one thing
ahead of any further restructuring: checking what a SIGNED-IN member does, on a phone — signed-in
editing, mobile gestures, the installed app. Signed in, the app had been proven in halves: the pages
ran against a hand-written Firebase stub, the security rules were tested on their own, and nothing
but production ran the two together. The review also advised keeping changes to the Calendar's state
small and testing sequences of events, shrinking the larger controllers gradually rather than
rewriting them, and keeping the real-payslip check before any pay change. The owner took up three
pieces of work, each landing on its own:

| | What | Where it lives |
|---|---|---|
| 1 | Signed-in journeys through the REAL Firebase SDK, rules and Cloud Functions, on Chrome's and Safari's engines at phone size | `npm run test:signed-in` (#1749); README → The test lanes. Its Android Chrome half gates the Hosting deploy (below) |
| 2 | A permanent seeded test of event SEQUENCES for the Calendar's access, reads and redraws | `calendar-sequences.test.mjs` (v25.79): its first run found a fault, fixed in the same release |
| 3 | A real-Android release checklist beside the iPhone one, and a "sign out, then Back" check on both | `ANDROID_RELEASE_CHECKLIST.md` |

**The next day, the lane's Android Chrome half joined the Hosting deploy gate** (owner, 12 Nov 2026),
asked for by the external review of v25.87 ("make the signed-in browser journeys a release
requirement"). The test the maintenance calendar had set for 25 November, every run green and none
re-run, was already met: 36 `signed-in` jobs, 28 completed and every one green, the other 8 cancelled
by the Tests workflow's own concurrency, none failed and none re-run. **Its iPhone half stays out**:
WebKit stays out of the deploy gate (owner, 8 Sep 2026, above), and neither trigger that decision
names has fired. It still runs on every branch. In the gate it runs beside the smoke jobs, so a
release waits no longer; the cost is one more way for a release to be held. The Rules and Functions
deploys keep their own suites (`test:rules`, `test:functions`) and do not run it.
`workflow-hygiene.test.mjs` holds both halves: the job is in the gate, and it runs one engine.

**Weighed and NOT done**, recorded so they are not proposed again as unfinished business:

- **The signed-in journeys do not run against production.** A check signed in to the live site needs
  a real account with real claims on the live project: a standing credential held by CI, and test
  records written into the roster everyone reads. The emulators run the same code path — the real
  SDK, rules and functions — with nothing real at stake. The live site keeps its own signed-out
  health check (`npm run test:live`).
- **The lane does not force the back/forward cache.** Playwright launches Chrome with that cache
  turned off. Turned back on, Chrome still declined to keep the page (its reason:
  BrowsingInstanceNotSwapped), and WebKit reloaded too (measured 11 November 2026). Forcing a restore
  would take browser launch flags whose other effects nobody has measured, for one guard that
  `page-session.test.mjs` and `e2e/auth.spec.js` already test by sending the restore event
  themselves. A real restore is checked by hand instead: "Sign out, then Back" on both phone
  checklists.
- **No broad rewrite of the larger controllers.** The review itself advised against one. The size
  ratchet (`coordinator-ratchet.test.mjs`) already holds every large module to its measured size,
  with any raise argued beside its cap, and the Calendar's four steps above are what gradual looks
  like here.
- **The three compromises stand as already recorded**: the surname default password and its forced
  change (PASSWORD_DESIGN.md), the document files behind a bearer address with the stored one as the
  fallback (KNOWN_LIMITATIONS.md → "The document FILES are protected by a bearer URL, not by auth"),
  and the second of two editors on one day not being warned (KNOWN_LIMITATIONS.md → "Two editors on
  one day"). The review listed them as still standing, not as new regressions.

**What only the owner can do:** run the Android and iPhone checklists on real phones before a release
that touches what they cover; run `npm run test:payslip-local` before any pay change; and confirm a
document opens by its short-lived signed address, as the bearer-URL entry in KNOWN_LIMITATIONS.md
describes.

## No build step — the trade, and the two things that would reopen it

**Status:** Standing (the architecture table's "no bundler" rule) · **Triggers named below; neither
has fired.** Moved here from `CLAUDE.md` on 15 Sep 2026, where it had grown into the table's
third-longest row. The rule stays there in one line; the argument is here, because this is a
decision with a trigger and that is what this file is for.

The no-build rule buys three things — zero toolchain, direct debuggability, and no
build-supply-chain — and pays for them in hand-maintained work a bundler would do for free:

- the `modulepreload` lists (index, paycalc and links have the deepest graphs; the other six pages
  carry only the three fixed gstatic SDK tags every page has, which name one URL each and so cannot
  fall behind a graph). CI-locked by `sw-asset-check.test.mjs`.
- the service worker's precache list,
- the two-location version bump,
- the `generate-*` codegen,
- the CSP `*-boot.js` shims,
- the pure-helper splits that keep `firebase-client.js` testable in Node,
- and the `normaliseSurname` browser/functions duplication.

**The cost side is COUNTED FROM THE FILESYSTEM, never written down.** `doc-parity.test.mjs` derives
those totals and fails on a stale figure. It has to: at v21.62 all five written figures were wrong,
two by about 80%, and **every one of them understated the cost** — that is, all five errors ran in
the direction that makes this trade look cheaper than it is. A threshold that nobody re-measures
decays toward the day it was written, and this is precisely the row where being wrong changes an
architectural decision.

**Revisit — do not auto-adopt — when either:**

1. **You want real TypeScript types.** `tsc --noEmit` already runs the checker without the emit, so
   this is about types in the source, not about checking. Note the scope limit: not over `functions/`
   or the service worker (`typecheck-scope.test.mjs`).
2. **A bug is traced to drift in a hand-maintained list.** That is the failure the lists' CI locks
   exist to prevent; one getting through is evidence the locks are not enough.

Until one of those, the trade favours no build.

**A third input, measured, and deliberately NOT a trigger.** The Calendar's cold parse-and-execute
cost under 6× CPU throttling is in `LATENCY.md` → Phase 3, beside the ladder reading that would
justify acting on it. It is not a reason to adopt a bundler by itself: the assets are
service-worker-cached and the cost is one-off per version.

## Version bumping and merging — the incidents behind the rules (moved from CLAUDE.md, 7 Nov 2026)

`CLAUDE.md` → *Version bumping* states each rule with a one-line reason. These are the incidents
that wrote them, kept here so the rules stay short where every session reads them. Every rule below
is still in force; nothing here reopens one.

- **Bump against `main` — because v22.29 shipped twice.** Two sessions branched from the same
  version and both bumped to the same next one: the logo change (#1311) and the Huddle table fix
  (#1312). The second merge did not conflict, because `roster-data.js` and `service-worker.js`
  already said the value the incoming commit wanted. `service-worker.js` was then BYTE-IDENTICAL
  across the two releases, so a browser byte-comparing it installed no new worker — no activate, no
  new cache, no precache — and a device that took the first 22.29 kept serving the first release's
  assets. Nothing heals it: the worker never re-fetches a cached file, so those devices kept the first
  release's files until the next bump. Hence the re-check of `origin/main` immediately before merging.
- **A gap is the rule working — there is no v23.22.** Two branches held it at once on 8 Sep 2026;
  both re-checked `main` before merging and both re-bumped, to 23.23 and 23.24. A skipped number is
  what a caught collision looks like from afterwards, which is why it is never reused to close the gap.
- **Exactly 0.01 per change — after the v15.70 → 15.80 → 15.90 slip**, where a batch was bumped by
  0.10 at a time and burned the version space. The "every 0.10 version" rule only ever governed when
  the docs are re-stamped.
- **"Both runs green" is usually one run green and one cancelled** (measured 15 Sep 2026). The two
  runs share a concurrency group, so the `push` run is normally cancelled within seconds of the
  `pull_request` run starting on the same commit: on v23.82's head the pull-request run carried every
  job green and the push run was cancelled after four seconds. That is the design (the entry on the
  cancelled `push` run, above). What the rule guards against is reporting green off a run that did
  not include the `version` job.
- **The two-runs trap on the `version` job** (6 Sep 2026, twice). Merge promptly and the run fired
  when the pull request was OPENED compares the branch against a `main` which by then CONTAINS it —
  "main is v22.99 . this branch is v22.99", failed, and an email about a release that was correct.
  The job now detects an already-landed branch by CONTENT and skips; ancestry cannot tell you, because
  `main` squash-merges. The second lesson cost more: the first of those two went unnoticed because the
  merge was reported fully green off the `push` run alone.
- **Do not stack branches — it cost three branches and a pull request.** `main` squash-merges, so a
  child branch cannot be rebased once its parent lands; every commit replays and conflicts, and the
  only way out is a fresh branch from `main` and a cherry-pick. That cost three branches and one
  pull request closed as superseded across v23.79 → v23.82.
- **One Playwright run at a time.** Two concurrent runs produced a false red (14 Sep 2026), and
  checking out another branch mid-run invalidated a 13-minute e2e pass that then had to be redone.
- **The Documentation milestone row names the milestone, not the version.** It used to state the
  current version, and it rotted on every release — it read 23.23 while the app shipped 23.24, then
  23.25, then 23.26 — because bumping it is not part of shipping. What the stamp guard actually
  requires is the 0.10 milestone, so that is what the row states; `APP_VERSION` is the only place to
  read the version.
- **Who uses which phone is an OWNER FACT** (owner, 8 Sep 2026). `CLAUDE.md`'s platform line was
  wrong twice in one day, in opposite directions: it said "all staff use Android phones", was
  corrected to "the installed app is mainly iPhone", and neither was right. The owner's own phone is
  an Android (a Galaxy S26), the personal-phone population is mixed, and the work phone is Android
  with the install not yet permitted — so both platforms are served equally, and no screenshot, bug
  report or single device decides which one matters more.
