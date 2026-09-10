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
assert visibility before position). And `paycalc-app.js` sits at **1,900 of a 1,900-line ratchet** — the
room a cap carries for a fix is already spent, so the next change to that file, however small, must
move something out first. **Do not make that move speculatively.** The seam should be drawn by the
change that needs it; a module carved today to hold three click handlers is a guess at where that
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

  **It is now COUNTED rather than noticed.** `.github/workflows/race-detector.yml` (9 Sep 2026) runs
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

- **The Huddle print notice keeps `:has()` — DECLINED** (external review, 8 Sep 2026). Replacing
  `body:has(#huddleViewer.visible)` with a body-state class was proposed on portability grounds. The
  app already leans on `:has()` in five stylesheets, and the other uses fail *worse*: an unsupported
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

---

## The dropdowns that stay native (8 Sep 2026, v23.33 — completed and enforced v23.38)

`select-sheet.js` replaced the OS popup everywhere a reader reads a list — the Calendar's member
picker, Admin's three member selects and its month filter, the pay-period selector and the rest of
the calculator's fields, and the Links saved-setups picker. Two were left alone on purpose, so that
"why is this one different?" has an answer:

- **`#otIdentityMember` (Overtime).** It is `disabled` and carries exactly one option — the signed-in
  member — because, as its own comment says, "there is genuinely nobody else to pick". It never opens
  a popup at all, so there is no OS surface to replace; enhancing it would swap a disabled field for
  a disabled button and change nothing a reader sees.
- **`#monthJumpMonth` / `#monthJumpYear` (Calendar month jump).** These live INSIDE an already-open
  lightbox. A picker sheet over a dialog is a second modal layer, and the lists are 12 months and a
  handful of years — short, ordered and familiar, which is the one case a native popup handles well.

**The trigger that would reopen either:** a report that the month-jump selects look wrong on a phone
(the same report that started this), or the Overtime identity bar becoming a real choice — which it
would, the moment a manager can answer on somebody else's behalf.

**Two more were not decisions at all — they were misses** (v23.38). `#rosterType` on Operations was
in the markup and simply not in the list; `#acctGradeFilter` is built in JavaScript after two
Firestore reads, so an id in that list would have been skipped silently. Both are now enhanced, and
the reason they went unnoticed for a release is worth keeping: **a missed select is invisible to
every lane the repo has.** The closed control looks identical, the popup is the platform's, and
Playwright's `selectOption` drives both — so the e2e suite, the visual baselines and the axe gate
are all equally green either way. The three exclusions above are therefore an EXEMPTION TABLE in
`select-sheet-parity.test.mjs` rather than prose alone: adding an id there is how the decision gets
taken, and the alternative was taking it by forgetting.

### What a wider scan then found (v23.40)

The guard shipped looking in two places — `<select id>` in served HTML, and modules calling
`createElement` — and a `<select>` reaches a reader from a third: **a JS template literal**. Two
families were invisible to it, and neither is minor:

- **`#loginGrade` / `#loginName` — the sign-in cascade. AN OPEN OWNER DECISION, not a decision
  taken.** This is the strongest remaining candidate in the app: a grade picker that enables a
  roster-length name list, the FIRST dropdown any member touches, rendered on all six protected
  pages plus the Calendar's front door. It is also the highest-blast-radius change available —
  `e2e/auth.spec.js` drives it on every one of those surfaces — which is why it is recorded rather
  than converted in passing. **Gareth's call.**
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
