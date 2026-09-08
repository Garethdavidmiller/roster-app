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
