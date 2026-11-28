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

**Order.** The two categorised lists come first, then two standing references (the no-build trade
and the version-bump incidents), then the dated entries, oldest first — append a new one at the end.
A superseded entry is deleted once its replacement records what it superseded.

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
change will want its boundary, and the ratchet is doing exactly its job by waiting. When it came,
the ready candidate was the cross-card navigation block (the banners' open-and-scroll helper and
the three link wirings, ~20 lines, no calculations), named for what it is — never for the grouping that was not
built. (It left on 25 Nov 2026 with the banners' ticks, for the module that owns the banners:
`wireBannerTicks`, paycalc-money-banner.js — the HPP card's back-pay link folded into the same
open-and-scroll.) The transfer card's hash branch stays where it is; its
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

- **A member whose own row is hidden lands on the default member's calendar, and is told so** (owner,
  18 Nov 2026: no change) · **Trigger to revisit: a member, moved off the roster, confused by where the
  Calendar opens.** A move into management hides the member's own row, so the name their device saved
  no longer resolves; the Calendar falls back to the default member and says "Your name is no longer
  in the roster — showing … calendar. Choose a name from the list above." (`_showStaleMemberBanner`,
  `calendar-app.js`; `_staleMemberName`, `calendar-member.js`). Opening somewhere else, or a different
  message, was offered and declined.
- **A member's own saved roster can show for a moment before the phone learns of a password reset**
  (owner, 18 Nov 2026: acceptable) · **Trigger to revisit: the own-roster copy's own trigger (below,
  5 Oct 2026).** That copy is painted the moment the Calendar opens, labelled "Checking for changes…",
  before the identity is confirmed. A reset is known only to the server, so a phone learns of it on the
  network check that follows; when access is refused, the copy is deleted with it (CALENDAR_DATA.md 17).
  Holding the paint until the network answers would undo what the copy is for: a calendar at once,
  offline included. What shows in that moment is the member's own shifts, on their own device.
- **No "sign out everywhere, keep the password" action** (owner, 13 Nov 2026) · **Trigger to
  revisit: a lost phone whose finder signs in with the surname before the member has chosen a new
  password.** A lost-phone Reset (Operations → Reset,
  "Their phone is lost or stolen") is the only tool that signs every device out, and it puts the
  password back to the surname default, so until the member chooses a new one the surname opens the
  account. The action declined would sign every device out without touching the password: a new
  endpoint. What stands instead is the Reset's own outcome, which asks the admin to have the member
  sign in on another device and choose a new password. The gap as it stands: KNOWN_LIMITATIONS.md →
  "A lost-phone reset still leaves one narrow gap".
- **A short laptop window keeps the desktop's day cell** (owner, 13 Nov 2026: "it looks fine on a
  desktop PC but on this laptop the calendar looks weird") · **Trigger to revisit: a laptop staff
  actually use where a five-row month's last week falls below the window.** From v25.51 a desktop
  window under 821px tall put each day's badge and time on one line so the month fitted. It fitted
  only from ~1366px wide: in narrower cells the pair stacked again, so one month drew two kinds of
  day, and at 1280px (a 1920-pixel laptop at Windows' 150%) the stacked cell made every row taller and
  the month did not fit anyway. From v26.02 the cell is the desktop's (the date, the badge under it,
  the time under that) with tighter spacing. A five-row month and its key fit 1366×650 and 1280×672;
  at 1280×593 (a 1920×1080 laptop at 150%, taskbar showing) a five-row month's last week fits and the
  key, and a six-row month's last week, are below the window. **Putting the badge and the time back on
  one line to win those pixels is the thing not to do.** The reasoning is the short-window block in
  `index.css`.
- **Admin's "Apply to multiple days at once" box stays open on a short laptop window** (owner, 14 Nov
  2026) · **Trigger to revisit: a manager on a laptop who has to scroll to reach the days they are
  editing.** v26.05 trimmed its spacing, so a 1280×593 window shows three days where it showed two.
  Folding the box to one line until clicked would show five or six, but it would hide the two steps
  that tell a manager the bulk route exists, and a member cannot look for what they never saw.
- **The prose measures stay in `ch` as written** (owner, 14 Nov 2026) · **Trigger to revisit: a reader
  finding the long notes hard to follow on a laptop.** A `ch` is about 1.3 characters in Inter, so the
  64–72ch caps run to about 80–94 characters a line, not 75 (css-tokens.md → Reading measure).
  Narrowing them to a literal 75 adds roughly a line to every capped paragraph on a short window.
- **The Newsletter button follows its latest issue** (owner, 14 Nov 2026) · **Trigger to revisit: a
  newsletter that comes out less often than every six weeks, or a newly uploaded issue that stays off
  the menu.** None had come out between July and November, so the ☰ button opened July's issue as
  though it were the latest. It was first hidden by hand (v26.07, "temporarily hide it", a switch
  someone had to remember), then the owner asked for it to hide itself when the newsletter has not
  been updated for a month or more and to come back on upload. That rule replaced the switch in
  v26.08: the button shows while the latest issue (by the issue date the admin picks) is under SIX
  weeks old — six, not four, so a monthly issue that comes out a few days late does not vanish for
  those days. `newsletter-recency.js` holds the rule and argues where the answer comes from: the
  Calendar asks once a load as its documents open, and every page reads the date this device keeps.
  It said "once a day" when proposed; it asks on every Calendar load instead, one small read, so an
  upload brings the button back the next time anyone opens the app. What moves with it, and is held
  to the number by `guide-app-parity.test.mjs`: the Staff Guide's Latest tile and the welcome email ("for six weeks after
  each issue"), and the Operations card, whose receipt says whether the issue just uploaded will be
  offered. An upload still notifies staff and the notification still opens it (`#newsletter`),
  whatever its age. To change the window, change `NEWSLETTER_RECENT_DAYS` and the words the test names.

- **The month grid takes no pinch-zoom** (owner, 10 Nov 2026) · **Trigger to revisit: a member who
  needs to zoom the month and cannot.** The grid's `touch-action: pan-y` keeps a sideways swipe for
  changing month, so a pinch that STARTS on the grid does not zoom; a pinch anywhere else on the page
  does. Allowing it (`pan-y pinch-zoom`) needs a test on a real iPhone and a real Android phone first,
  for the gesture arbitration the code warns about, and was declined.

- **A payday counts as paid from 12:00** (owner, 10 Nov 2026 — kept) · **Trigger to revisit: payroll
  moving the time pay lands.** It is the same rule everywhere a payslip is "paid" or "current", so the
  whole-app check left it alone.

- **Notifications after a sign-out are re-saved by the Calendar and Settings alone** (owner, 10 Nov
  2026; Settings joined 22 Nov 2026, `notif-card.js`) · **Trigger to revisit: a member who signed in
  on another page reporting missed notifications.** Signing out removes the device's push record, and
  the next signed-in Calendar load saves it again, as does Settings each time it opens signed in (so
  its Notifications card's "✓ On" has a record behind it). A sign-in on any other page does not, so
  the drawer's bell can read "on" with no record until one of those two opens, and the app opens on
  the Calendar. Re-saving on every signed-in page would cost a call on every load (`getNotifState()`
  after `ensureFirebaseSession`).

- **A back-pay lump typed from the payslip carries no "fill in your hours" line** (owner, 10 Nov 2026
  — the July line, narrowed) · **Trigger to revisit: none expected.** Hours cannot change a figure
  copied from the payslip, so the banner's second line shows only for a computed lump
  (`paycalc-money-banner.js`).

- **Two workflow questions, both left as they are** (owner, 10 Nov 2026) · **Trigger to revisit: a
  branch's deploy holding up a release from `main`, or an indexes-only change becoming routine.** A
  manual deploy run from a branch still shares its workflow's queue with `main`, because the groups are
  per-workflow and ref-independent on purpose (`deploy-functions.yml`, `deploy-rules.yml`); and a change
  to `firestore.indexes.json` alone still needs a version bump.

- **A Spare week's leave costs at most four days** (owner, 21 Nov 2026 — "A full spare week off
  should be charged as 4 days AL"; part weeks "1 a day, at most 4"; "count only"). A Spare week is four
  days' work of 35 hours, but the roster marks all seven days Spare, so a whole week off was charged as
  six (Monday to Saturday). Each day costs one, and a week stops costing at four, in date
  order (`pastSpareWeekCap`, `al-entitlement.js`); the booking preview asks the same rule of the week as
  it will stand after the save (`projectAlBooking`, `admin-al-projection.js`) and its Spare line says so.
  **CEA and CES only** (owner, 21 Nov 2026): a Dispatcher's Spare days cost one each, as before, because
  the four-day, 35-hour Spare week is the CEA and CES roster's, read off the member's grade on the day
  (`spareUnderneath`). A week running over New Year counts its December days first. **Count only:** every
  day is still written as leave, so the Calendar shows the whole week off and nothing saved had to
  change. Weighed and not chosen: writing leave on four days and Rest Day on two (weeks already booked
  would still count six), and charging any leave in a Spare week as four. **The cap follows the week as
  rostered** (owner, 22 Nov 2026): a week the BASE roster makes Spare costs at most four however many of
  its days a roster upload has since given named shifts (`rosteredSpareDay`), where it used to count only
  the days still Spare — so a whole week off cost 4, 5 with one day assigned, 6 with two. The base line,
  not the record, decides: leave over an assigned day keeps only `replacedType: 'shift'`, which a swapped
  working day leaves too, so a Spare turn saved over a day the base roster has at work is not a Spare
  week and costs a day. The booking preview still CALLS a day Spare only while it is unassigned
  (`spareUnderneath`). How the clerks' grid books one is AL_WORKBOOK.md §10
  question 17.

- **Leave over rest-day working is free, whatever kind** (owner, 10 Nov 2026 — "Free, like plain
  RDW") · **Trigger to revisit: payroll charging a day of leave over a rest-day Training, Meeting or
  Spare record.** Leave booked across a base rest day holding RDW, an Other day (Training, Meeting … —
  "TRG RDW") or a Spare turn costs no entitlement; only a recorded swap (`shift`) on a rest day does
  (VAL-AL-001). The base roster is the witness, because once leave replaces the record only its type
  survives (`isContractedWorkOverride`, `override-utils.js`). Neither booking path asks about such a
  day: it is settled, and free. The roster review treats the roster's leave over one as it treats leave
  over an RDW — as the rest day it costs nothing on. An ABSENCE is another matter: the Calendar shows
  one over a rest-day Other day or Spare turn, but hides one over Rest Day Working (an absence on a
  rest day shows only where it replaced contracted work). So the Absence card leaves a rest day holding
  RDW, or leave that cost nothing, as it is and names it, for Change a Shift to deal with (review,
  Nov 2026) — except where the work earned a day in lieu, which the absence takes back as before.

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
  navy on most pages, raspberry on one Trains row and a gold tint on Link Designer, so one screen could show
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
  everyone"; v24.81) **— and was the station PIN's** (owner, 22 Oct 2026 — "the station pin staff should be
  able to view the trains page"; v24.84; **ended 23 Nov 2026 with the PIN** — "The staff PIN retired",
  below: the station's shared PC now signs in by name) · **Trigger to revisit: the page showing anything that is
  somebody's own — a member's shifts, leave or pay.** It was an admin preview from v24.71 while it was
  shaped. The v24.81 trigger ("staff on the PIN asking for it") is what fired: the people customers ask
  about the timetable are at the station, often on its shared PC. The PIN is admitted because the page
  reads nothing — the timetable is public — so a station that keeps its PIN there can reach nothing it
  could not already. That was the whole argument, and it would have stopped holding the moment the page
  showed a member's own data. Narrowing the member side again is one line in
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
  **Rotate the links once now** (owner, 12 Nov 2026; run by the owner on 27 Nov 2026). Built as a button — Operations → Document links —
  rather than a one-off script, because nothing in a session can reach production and the owner can
  press a button; it stays, so a leaked link is one press from dead. It keeps the fallback: a rotation
  gives each record a NEW permanent link, it does not take the stored link away.

- **The staff PIN session keeps NO server-side time limit** (owner, 7 Oct 2026) — **overtaken 23 Nov
  2026: the PIN is retired** ("The staff PIN retired", below), and a leftover PIN session is signed out
  on its next Calendar or Trains load. The record as it stood: · **Trigger: a PIN
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
  Restated 27 Nov 2026: *"There are about 5 station computers, but we use our own windows login on
  each one. So whilst it is a shared pc, no data is shared."* So no design may cite "a shared station
  PC" as a reason on its own: what a station PC risks is the same as a phone, being left unlocked.

- **Year to Date figures that do not fit the tax code are NOT used** (owner, 15 Nov 2026). A
  member's estimate took no tax at all and said "a refund may be due": their Tax Paid was far above
  what their code takes over the year (the figures fit a payroll working out each payslip on its own,
  week 1 / month 1, though the payslip printed the code plainly), and the cumulative method read the
  difference as over-collected tax. Three answers were weighed — keep the £0 and only reword the
  line; show the standard tax whenever the year looks over-collected; or check the figures fit the
  code — and the third was chosen: it refuses only figures that cannot have come from the code (Tax
  Paid more than £2 over what it takes by their own payslip) and leaves a genuine short-paid refund
  alone. The accepted cost: a code raised since that payslip, already typed in, gets the standard
  figure, with a line saying payroll may give some back. Rule: `.claude/rules/paycalc.md` →
  invariant 18.
  **Extended to figures UNDER the code (owner, 21 Nov 2026).** The owner found the next payslip's tax
  too high after entering Year to Date figures. Under the code had been read as a code lowered
  mid-year, which cumulative PAYE collects; a review found it was far more often a Settings code with
  less tax-free pay than the payslip's (often the 1257L default) or figures filed one payslip early,
  and each charged the whole year's "shortfall" on the next payslip with nothing said. The accepted
  cost: a code genuinely lowered since gets the standard figure, with a line saying payroll may take
  more. K codes stay over-only, because the 50% limit leaves their Tax Paid short by design.

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
  job does. The account is the comment at the top of `deploy-hosting.yml`'s `jobs:`. **Sharded two
  days later, before either half outgrew it** (owner, 12 Nov 2026), because the wait itself was the
  cost: three shards per project, the same list in both workflows, 5 to 8 minutes a job on the first
  run against 16 to 18. `fullyParallel` came with it, so a shard is a count of tests, not of files.

- **A few Safari tests gate the release** (owner, 17 Nov 2026). Supersedes "WebKit stays OUT of the
  deploy gate" (owner, 8 Sep 2026), which kept every WebKit test out of the release: a full WebKit run
  then took 13.2 minutes against a deploy of about eleven and a half, so gating on it would have
  roughly doubled time-to-live for every release, an emergency fix included; and a hand-picked subset
  was refused as the shape this repo keeps finding stale. Its trigger was a Safari-only regression
  reaching production or the work-phone install being permitted; its full text is in git. Every branch ran the WebKit suite, but the tree `main` RELEASES — two branches,
  each green on its own, merged — was tested on Chromium alone, though the app serves iPhone and
  Android equally (owner, 8 Sep 2026). **What
  gates now:** one job, `safari` in `deploy-hosting.yml`, on the iPhone's engine: every page, guide and
  old address opening with nothing thrown (`e2e/every-page.spec.js`), and the signed-in journeys'
  iPhone half through the real SDK, rules and functions (90 branch runs green in a row when it joined,
  none failed). **Why yes now, when 8 Sep said no:** that decision's cost was time, because the gate
  ran its tests one after another. Since 10 Nov the gate's jobs run side by side (the entry above), and
  this job should take about five minutes with its setup (its tests took two and a half locally;
  measured at 3m 57s and 5m 00s on the first two releases that ran it, both 18 Nov 2026), against
  9m 36s for the slowest smoke shard in the release of 17 Nov 2026, so a release waits no longer.
  **What stays out, and why:** the whole WebKit suite, nine jobs with the
  longest over twenty minutes, which every release would wait for. The 8 Sep objection to a hand-picked
  subset still stands, so neither set is a list: one file whose pages come from `scripts/app-pages.mjs`,
  so a new page joins by itself, and one whole lane. **The cost:** one more way for a release to be
  held. Red here, nothing is uploaded; both sets retry once on CI, and a test added to
  `every-page.spec.js` gates every release from then on. `workflow-hygiene.test.mjs` holds the wiring,
  and that WebKit runs in no other gate job. **With the reused proof** (the entry below, 18 Nov 2026):
  `safari` is the one gate job it never stands in for, because the pull request's record covers no
  WebKit check but signed-in's iPhone half, so a proven release waits for this job alone.
  **Should the pull request's Safari run stand in for this job too? No — weighed and kept** (owner,
  18 Nov 2026). It could: on the same tree the pull request runs more than this job does (the whole
  WebKit suite on both devices, `every-page.spec.js` included, and signed-in's iPhone half), and a
  proven release would then take a minute or two instead of about six (6m 29s and 5m 52s on the
  first two). **Kept because** this job is then the only browser test a release runs for itself, on
  the tree it uploads: if the lookup that reuses the proof ever went wrong, this is what still stops
  a broken page reaching an iPhone — two independent locks, not one (defence in depth). The price is
  the job's own four to five minutes, which nobody waits on. Doing it properly is not small either:
  e2e.yml's record simply waiting for `webkit` as well would tie the Chrome proof to the run's
  slowest jobs, so it would need a Safari record of its own. **Trigger to revisit:** this job holding
  releases on false failures, or a need for faster releases, such as several urgent fixes in one day.
- **CI made quicker in three ways; the release gate may reuse a pull request's proof — ADOPTED**
  (owner, 17 Nov 2026). Measured on #1803: the pull-request checks took about 15 minutes and a
  release about 11, almost all of it test time, not setup. (1) **Shards are cut by measured time**, not
  by count: Playwright's equal-count cut gave each project's first shard every heavy file (desktop
  Chrome 9.3 minutes against 5.2 and 4.7). Each entry's `weights` moves the cut; they drift towards
  uneven, never towards wrong, and `workflow-hygiene.test.mjs` fails if Playwright stops reading
  them. WebKit and the iPhone went to four shards each. (2) **A documentation-only pull request skips the
  browser jobs**: pushes of `.md` alone already started no run. (3) **The Hosting deploy skips its gate
  jobs when the pull request's Tests run passed the same four on the identical tree.** That is the one
  that touches the release gate, so it fails closed at every step: only a push, only a record e2e.yml
  made in this repository, only after all four counterparts SUCCEEDED, only on a byte-identical
  tree. Main having moved since the PR's run, a red run, an expired record or an API error all run the
  full gate. **What it gives up:** a second run of the same tests on the same files, which can only
  catch a test that flakes. **Declined alongside:** more Playwright workers per runner (measured as a
  flake source, playwright.webkit.mjs), larger paid runners, dropping the one retry. Bounded by the
  free plan's ~20 concurrent jobs: a job added to the run is also a job that queues.

- **The Huddle print notice keeps `:has()` — DECLINED** (external review, 8 Sep 2026). Replacing
  `body:has(#huddleViewer.visible)` with a body-state class was proposed on portability grounds. The
  app already leans on `:has()` in several stylesheets, and the other uses fail *worse*: an unsupported
  engine would leave a selected back-pay/HPP mode option and a ticked Link Designer objective looking
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
- **Link Designer compare on a phone — self-labelling cells: DECLINED** (v22.77, external review). The
  proposal was to give each compare cell its own day label so the grid survives a narrow screen.
  It is the wrong device for the job rather than a layout to fix: a 24x7 grid of two designs is a
  desk task, three named designers do it, and there is no reported use of compare mode on a phone.
  Buying it would cost the coordinator complexity and every compare cell a second label to keep in
  step. The narrow case is already served — the columns stack below 1024px and each scrolls — and
  what the review was reaching for (finding the changed lines quickly) is answered instead by the
  **only-the-lines-that-differ** view shipped in the same release, which helps on every width.
  Reopen only if somebody reports actually using it on a phone.
- **Link Designer sticky save bar — density pass: DECLINED** (v22.77, external review). Nothing is reported
  wrong with it, it has already had a tuning pass, and "denser" is not a defect. This is recorded
  rather than left on a list because it has now been deferred twice; a third deferral would be a
  decision nobody is making.
- **Profile photo / avatar — removed** at v12.22: non-vital, and its canvas reposition editor was ~350
  lines of the riskiest code in the app for a 26px badge. The nav footer shows initials on a stable
  per-name colour (`avatarInitials`/`avatarHue`, which stay). Restoration spec and the removal
  checklist to reverse: `git show 28b217d0:docs/ROADMAP_HISTORY.md` → "Removed features".
- **Cultural calendar — removed** at v13.23 (annual maintenance burden + GDPR Article 9 exposure +
  no observed usage). **A restoration must ship a right-to-erasure path for the stored preference
  first** — it is special-category data. Full restoration spec: `git show
  28b217d0:docs/ROADMAP_HISTORY.md` → "Removed features".
- **Password security — the original five-stage plan is superseded** by the "C-lite" design in
  `AUTH_AND_SESSIONS.md` → "Chosen passwords", which did not wait on email verification. The original staged text is in git
  (`git show 28b217d0:docs/ROADMAP_HISTORY.md` → "Password security — the original five-stage
  design"); do not plan from it.
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

## No build step — the trade, and the two things that would reopen it

**Status:** Standing (the architecture table's "no bundler" rule) · **Triggers named below; neither
has fired.** Moved here from `CLAUDE.md` on 15 Sep 2026, where it had grown into the table's
third-longest row. The rule stays there in one line; the argument is here, because this is a
decision with a trigger and that is what this file is for.

The no-build rule buys three things — zero toolchain, direct debuggability, and no
build-supply-chain — and pays for them in hand-maintained work a bundler would do for free:

- the `modulepreload` lists — no longer hand-kept: since 25 Nov 2026 `npm run generate:copies`
  writes them from the import graph (index, paycalc and links preload theirs whole; every page
  carries the SDK tags), so they now count under the codegen below.
- the service worker's precache list — its app pages, their stylesheets and modules written by
  `npm run generate:copies` since 25–26 Nov 2026; the guides and assets beside them still by hand,
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
   this is about types in the source, not about checking. Note the scope limit: not over the service
   worker (`typecheck-scope.test.mjs`); `functions/` has its own strict project since 25 Nov 2026.
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

## The dropdowns that stay native (8 Sep 2026, v23.33 — completed and enforced v23.38)

`select-sheet.js` replaced the OS popup everywhere a reader reads a list — the Calendar's member
picker, Admin's member select (`#fieldMember`) and its month filter, the pay-period selector and the
rest of the calculator's fields, and the Link Designer saved-setups picker. Some were left alone on purpose,
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
- **`.gen-slot-time` (Link Designer generator targets, one per shift slot).** Declared native: a dense table
  of times a designer sets in a run, not fields read one at a time. Replacing every cell of a table
  with a sheet trigger is a design question about tables, not a mechanical conversion. Designer-only
  surface, so nothing a member sees.

The second hole was quieter and is the one to remember: the runtime half asked whether a MODULE
calls `enhanceSelect` anywhere, not whether THIS select is enhanced. `link-designer-generator-targets.js`
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
  own comment argued the point). The Link Designer totals cells got a legend line for the same reason.

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
— the Link Designer heat map's busiest hours go white on white — and below 15.4 `:has()` and `Object.hasOwn`
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

**The viewer is on PDF.js 5.7.284 while the roster reader is on 6.5.438 (v25.91; the viewer moved
up from 4.10.38 on 24 Nov 2026, owner decision).** The two used to be one version, held by a test.
They part because PDF.js 6's legacy build targets Safari 18 (from 6.0.227; `ENV_TARGETS` in pdf.js's
`gulpfile.mjs`), and the app supports iOS 16.4 (above): moving the viewer to 6 would stop it opening a
file on older iPhones. Measured, not assumed: 6.5.438's legacy build calls `Promise.withResolvers`
(Safari 17.4) and no longer carries a stand-in for it, so iOS 16.4 to 17.3 would fail outright, and
whatever else it stopped converting is untested on those versions. 5.7.284 is the newest release whose
legacy build still targets Safari 16.4, and it still carries that stand-in, so the viewer took it. It
still has the Type 4 hang 6.5.438 bounds (functions/roster-geometry.js header), which is acceptable here
for the reason below. The server cannot stay behind instead, because only 6.5.438 bounds that hang, and
the server reads PDFs from outside the app, while this viewer opens only the app's own. From 5.x PDF.js
decodes some images with WebAssembly, which the CSP does not allow; the viewer asks for none
(`useWasm: false`) and loads PDF.js's plain-JavaScript JPEG 2000 and JBIG2 decoders from the build's
`wasm/` folder instead, so the CSP did not widen (pdf-viewer.js's header). `dependency-pin-parity.test.mjs`
holds the viewer to its own declared version, and says how to move it. **What would rejoin them:** the
iOS floor reaching 18.

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
| 1 | Signed-in journeys through the REAL Firebase SDK, rules and Cloud Functions, on Chrome's and Safari's engines at phone size | `npm run test:signed-in` (#1749); README → The test lanes. Both halves gate the Hosting deploy (below) |
| 2 | A permanent seeded test of event SEQUENCES for the Calendar's access, reads and redraws | `calendar-sequences.test.mjs` (v25.79): its first run found a fault, fixed in the same release |
| 3 | A real-Android release checklist beside the iPhone one, and a "sign out, then Back" check on both | `ANDROID_RELEASE_CHECKLIST.md` |

**The next day, the lane's Android Chrome half joined the Hosting deploy gate** (owner, 12 Nov 2026),
asked for by the external review of v25.87 ("make the signed-in browser journeys a release
requirement"). The test the maintenance calendar had set for 25 November, every run green and none
re-run, was already met: 36 `signed-in` jobs, 28 completed and every one green, the other 8 cancelled
by the Tests workflow's own concurrency, none failed and none re-run. **Its iPhone half stayed out**
then, because WebKit stayed out of the deploy gate (owner, 8 Sep 2026, above). **It joined on 17 Nov
2026**, in the gate's `safari` job (above: "A few Safari tests gate the release"). In the gate it runs beside the smoke jobs, so a
release waits no longer; the cost is one more way for a release to be held. The Rules and Functions
deploys keep their own suites (`test:rules`, `test:functions`) and do not run it.
`workflow-hygiene.test.mjs` holds both halves: each job is in the gate, and each runs one engine.

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
  change (AUTH_AND_SESSIONS.md → "The forced password overlay"), the document files behind a bearer address with the stored one as the
  fallback (KNOWN_LIMITATIONS.md → "The document FILES are protected by a bearer URL, not by auth"),
  and the second of two editors on one day not being warned (KNOWN_LIMITATIONS.md → "Two editors on
  one day"). The review listed them as still standing, not as new regressions. The third was closed
  in v25.90 wherever the device can reach the server; offline, the later save still wins.

**What only the owner can do:** run the Android and iPhone checklists on real phones before a release
that touches what they cover; run `npm run test:payslip-local` before any pay change; and confirm a
document opens by its short-lived signed address, as the bearer-URL entry in KNOWN_LIMITATIONS.md
describes.

## A grade has a date: each payslip is priced at the grade held on its days (owner, 13 Nov 2026)

The Pay Calculator held one grade per member, so a promotion re-priced every payslip they had ever
had, and the payslip that spanned it was right for neither side. The roster now dates a grade
(`roleHistory`, v25.99) and the calculator now prices each payslip by its days
(`.claude/rules/paycalc.md` invariant 17). The owner took four decisions ("Do all", 13 Nov 2026):

1. **The changeover payslip is priced by days**, not wholly at the new grade from the first payslip
   after the change. For the contracted hours it is exactly each day at its own grade; premium hours
   are an estimate on the same weighting. VAL-PAY-005 holds the check against the real payslip.
2. **The dated grade went into v25.99**, the release that moved the members: without it, that release
   would have treated the promoted member as the new grade on every date they had worked.
3. **The grade history is published in the staff file**, which is world-readable: "a CEA until
   21 Nov 2026" can already be worked out from the line moves, and a private store would be a second
   copy of the roster to keep in step.
4. ~~**A member who moves into management keeps the refusal card.** The page prices nobody whose role
   NOW has no confirmed rates; the payslips worked under the old grade are not offered.~~ **SUPERSEDED
   16 Nov 2026 (owner, "role at the time"; v26.23).** The page now admits a member who held a priced
   grade on any day of the payslips it shows, or today, and refuses each PAYSLIP with a day under a
   role with no rates instead (`.claude/rules/paycalc.md` invariant 13; the header of `pay-audience.js`).
   The same decision dates the leave allowance (`allowanceRole`, `al-contract.js`).

**Considered and not done.** Asking "switch?" on each promotion — the v25.99 behaviour, which applies
one answer to the whole history. Pricing by shifts — hours are stored per payslip, so nothing records
which side of the change a Saturday fell on, and inventing a split would look more precise and be less
true. Splitting a back-pay lump across a change of grade — no member's dates need it, and a data test
fails the commit that would. Teaching Team Week and the roster import the same dates — a ROADMAP entry.

**What would reopen it:** the real payslip pricing the change some other way (VAL-PAY-005).

## The leave sheet's Undo knows its Save's records by a mark on each one, not by a date (15 Nov 2026)

The Undo on Operations → Annual leave sheet may take back only leave its Save created and nobody has
changed since. It judged that by who wrote a day and when — annual leave by the log's author, stamped no
later than the log — and the log is written after the leave and a read of it. The same admin's change
in another tab during that time passed the test and was undone (external review, 15 Nov 2026). Now the
Save mints the log's id first and writes it onto every record (`uploadId`); every other writer builds
its record without it, so any rewrite drops it, and the Undo takes back only what still carries it
(`al-leave-plan.js` header). Rules first, the Save a release later (backend-first).

**Considered and not done.** Keeping each added day's revision in the log, as the review put it, and
undoing only records whose stamp still matches: the log is built from a read made AFTER the Save, so a
change that lands before that read would be recorded as the Save's revision — the same fault, in a
narrower window. Only something written in the Save's own transaction, with the record, can say the
record is the Save's. A list of the Save's writes in a document of its own fails the same way, with a
second set of rules to keep. Telling the admin's own booking apart by `source` was no help: it is
exactly what the Save writes.

**What it costs:** one optional field on a leave record, an id that names nobody, which the rules take
only from the admin writing manual annual leave. A log from before the mark has no Undo (review,
18 Nov 2026): the date was all that could judge it, and the date is what failed.

**What would reopen it:** another writer needing to mark records as its own — the builder takes the mark
only as its own argument, and a test fails if any caller but the Save passes one.

## Pay's first-visit Settings, and the Railcard's corrections: what moved, and what stayed (15 Nov 2026)

The external review of 15 Nov 2026 found the Pay Calculator's Settings long on a phone's first visit,
and asked that the Railcard guide keep the current rule prominent with its history expandable. Each line
was judged by one question — what would a member stop knowing if it went? — and moved only where the
answer was "nothing", or "nothing they need on this screen yet".

**Pay: four lines moved, none deleted outright.** How a promotion is priced went from the Grade hint to
a new Grade tip in the ? panel: the member it concerns is told when it happens (the roster line under
Grade gains its dates, and a one-time note says there is nothing to change). "Saved per payslip" left
the pension box: its label names the payslip being edited, and the header hint and ? panel say the rest.
The hint under "I'm not in the pension scheme" went: it repeated the tick's words, and what opting out
means is the ? panel's. "A loan applies to every payslip" moved from under the plan, which every first
visit reads, to the block shown only once a loan is chosen, naming the Hours tick it sends you to.
Measured at 375px on a first visit: the card is 109px shorter (1,155 to 1,046), including v26.16's
longer tax-code hint, which arrived in between.

**Pay: two lines kept that a trim would have taken.** The rate's "it updates with each pay award on its
own" is often the only place a member learns it — the step note shows only on a payslip from before an
award. The Postgraduate Loan's "repaid in addition to any plan above" is what a member with only that
loan needs.

**Railcard: reordered, not collapsed.** Three boxes opened on the date and the old wrong wording, so a
reader at the gateline met the wrong rule first. Each now opens with the rule, and the dated history
follows on its own line. Hiding the history was the review's suggestion and was not taken: it is written
for the member who learned the old rule from this page, and a note they must open to learn it changed is
one they will not open.

**What holds it:** `paycalc-copy-parity.test.mjs` → "Settings: a fact the card stopped repeating still
has a home"; `e2e/paycalc-entries.spec.js` → "the loan's every-payslip line shows only once a loan is chosen";
`guide-sources.test.mjs` → "a box that tells of this guide's old wording leads with the rule, and its
history follows".

**Open (owner):** when the Railcard boxes' history lines may go altogether.

## The January carry-back covers January 2026 too (15 Nov 2026)

**Decided (owner, 15 Nov 2026):** a January 2026 leave day may come out of 2025's allowance, as every
later January's may come out of the year before. Asked whether the arrangement made for 2026's days in
January 2027 held for every year, the answer was yes going forward and no going back: the choice began
with January 2027 (`LEAVE_YEAR_FROM`, `leave-year.js`), the first January anybody had asked to carry
days into. The owner asked for the backward half too, and v26.18 starts the choice at January 2026.

**Why 2026 and not earlier.** A lower year would offer nothing more. The panel lists only this year's
January and next year's, so every January leaves it at the end of its own year: January 2025 left on
31 December 2025, and January 2026 leaves on 31 December 2026.

**Why no backend release first.** The rules already accept it: `leaveYear` must name the year before a
January date, and no year is written into them. Only the app's offer had the floor, so the client
change ships on its own; the backend-first rule asks that the rules accept before the client writes,
and they already did.

**The caveat, told to the owner:** the cap ("no more than the earlier year has left") is judged on the
app's own 2025 figures, so it is only as good as the 2025 leave recorded in the app. A 2025 that was
not all recorded shows days left that were in fact taken.

**What holds it:** `leave-year.test.mjs` → "where the choice is offered"; `al-entitlement.test.mjs` →
"January 2026 is offered out of 2025's allowance, and the cap reads 2025"; `e2e/admin-leave-booking.spec.js` → "a
January 2026 leave day can be moved to 2025's allowance". Each fails with the start year put back to
2027.

## The Calendar keeps a month somebody moved to for half an hour, then opens on today (owner, 15 Nov 2026)

"It always reopens on June 2026" — the owner's report, from the installed app on Android. June was not
a month anybody browsed to: it was the month the app was installed. Until 10 Nov 2026 every render
stored the month on screen, today's included, so June was stored in June. From July the Calendar could
not tell it from a month somebody had moved back to, so it opened there, and every time it drew June
it stored it again. The 10 Nov release stopped storing today's month, but a month already stored still
opened, and stored itself again, until the member happened to move to today's. Today's month is what
opening the roster is for. A kept month is only for coming straight back: the phone reloading the app
behind another one, or a quick trip to another page and back. Now the month is stored with the time
(`BROWSED_MONTH_KEPT_MS`, `calendar-state.js`) and kept for half an hour. An app shown again after
longer than that out of sight goes back to today's month too, because a phone that kept it in memory
shows it and does not reload it. A page out of sight stores nothing, so a copy in the background (a
second tab, the app behind another one) cannot keep a month fresh. Admin's Calendar pill names its
week's date in the link (`?date=`) instead of writing the stored month as a second writer. A link that
names a date still opens that month whenever it is followed.

**18 November 2026 (owner): months ahead are kept too.** The August rule against reopening on a month
ahead is retired: the half-hour limit already answers its reason (somebody opening the app at their
next shift on a month they are not working). While it stood, a reload and a resume disagreed inside
the half hour: a month ahead was dropped by a fresh load (the drawer back from another page) and kept
by an app shown again from memory. `calendar-state.test.mjs` pins both directions.

**Considered and not done.** Never keeping the month at all: then a phone that closes the app behind
another one would lose the member's place a minute later, which is the one case the memory is for.
Keeping it until the end of the day: a month browsed to in the morning would still open in the evening,
which is the complaint again on a smaller scale. Snapping back only on a full relaunch: that misses the
app kept in memory, which is how most phones bring it back.

**What it costs:** a member who leaves the app on a month for more than half an hour and comes back
finds today's month, one tap of Today away from where they were. A month stored before this release
has no time, so the first launch with this release opens on today, whatever was stored.

**What would reopen it:** the owner finding half an hour too short or too long in use. It is one
constant.

## The Boxing Day day in lieu goes into the next year's allowance (owner, 15 Nov 2026)

**Amended (owner, 25 Nov 2026): it can be taken from 27 December.** In the next year's allowance it could
not be used between Boxing Day and New Year, and the owner wanted to take it on New Year's Eve. So it is
SPENT WHERE IT IS NEEDED: leave from 27 December that the year's own allowance cannot cover uses it in
that year, and otherwise it is in the next year's allowance, to 31 December ("keep it to 31 December").
The year's own leave goes first, because leave a year does not use is lost and the day in lieu keeps.
Nothing is asked or stored; it follows from the leave on record (`boxingDayLieuYear`, al-entitlement.js).
Chosen over asking at booking ("use your day in lieu for this?"), which would have needed a new field on
the leave records, a rules release first, and an answer every time. **What it costs:** a year's figure
depends on the December before, so booking or removing a late-December day moves the day between the two
years, and a surface showing a year needs the member's records back to the first Christmas (the
Calendar's leave panel reads from 26 December 2025). The rest of this entry is the 15 Nov decision.

**Decided (owner, 15 Nov 2026):** the day of annual leave in lieu for working a Boxing Day the member
was due to work goes into the NEXT year's allowance, to take at any time that year. A Boxing Day
worked in 2026 is a day in the 2027 allowance. The roster clerk said the day is valid for one year,
every year. Since 5 Nov 2026 (v25.37) the app had added it to the Boxing Day's own year, where it
could be taken only in the last days of December, or in January through the carry-back. Asked how
to read "valid for one year", the owner chose the next year's allowance.

**Where the rule lives.** One function says which allowance a worked Boxing Day goes into:
`allowanceForBoxingDay` (`christmas-leave.js`). The allowance counts the day through
`boxingDayLieuDays`, which is now asked about the allowance year. The Calendar's day panel and
Admin's week grid name the year that function returns. The Calendar's leave panel now reads from
the previous 26 December, so the day is in its figures. Admin's save checks the next year's
allowance as well, so leave over a worked Boxing Day still raises the bar when it leaves the
member over in that year. The line under an allowance names the Boxing Day ("Includes 1 day in
lieu for working Boxing Day 2026"), because the 2027 figure is about December 2026.

**What it costs:** nothing yet. The first Boxing Day these rules apply to is 26 December 2026, so
nobody has worked one. A record already made for that day moves from the 2026 figures to 2027's.

**Left where it was, for the owner.** A Dispatcher whose Boxing Day is itself a bank holiday (next
in 2028) earns the day through their bank-holiday rule, in that year, as for every other bank
holiday they work. Whether the clerk's year applies to that day too is the owner's question; until
it is answered, the code keeps the day where it was.

**What holds it:** `christmas-leave.test.mjs` asks the rule from both ends, and for every member
due at work on a Boxing Day from 2026 to 2029 it checks that the year the panel names is the year
whose allowance rises. The entry points are tested too: the Calendar's leave panel (2026 at the
contract figure, 2027 one higher, with the note), Admin's banner, the week grid's row, the
renderer's day flag, and Admin's two save checks, where leave over the worked Boxing Day takes 2027
over. `calendar-al-lightbox.test.mjs` holds the leave panel's read range through its figures, on a
Firestore stand-in that honours a query's range (24 Nov 2026; the browser tests' stub still ignores it).

## The timetable notice goes up now, after the other notices, and first in its final week (owner, 16 Nov 2026)

**Decided (owner, 16 Nov 2026):** the Calendar's notice about the new timetable (`timetable-soon-2026`)
goes up on 16 November instead of waiting for 6 December, and still ends with Saturday 12 December.
Until its final week it comes after the notices already running: the install notice where that one is
this device's (a phone or tablet in a browser), and the New link notice where that one is the member's
(somebody the New link page lets in). From Sunday 6 December it waits for nobody and goes first. It was
posted for 6–12 December only (owner, 23 Oct 2026), because the October notice ended six weeks before
the change; asked whether it could go up now, the owner said yes, in that order.

**Why the order, and why it changes on the 6th.** One notice a load is the rule the owner set in
October, and the two notices already running were there first. Waiting for a notice that is never
coming would hold this one back until both had ended, so it waits only where each is due: a desk or the
installed app has no install notice, and a member the New link page turns away has no New link notice.
In the final week the change is days away, the New link notice has ended, and the install notice keeps
until January. Waiting for it then could keep a phone from hearing about the Sunday until after it. The
notice was already wired before the install notice for that week (v24.96).

**With it, two pieces of polish:** the card is dated the day it went up ("Posted 16 Nov 2026"), its button
says where it goes ("Open the Trains page →", as the New link notice's does), and its App Notices entry
keeps "☰ then 🚆 Trains" from breaking across lines.

**What it costs:** a member sees the reminder up to three weeks before the change. The October notice
ended because six weeks early was too soon to be worth a screen. A member who answers it now is not
shown it again in the final week; the Saturday evening push still reaches the phones with
notifications on.

**What holds it:** `calendar-notices.test.mjs` block 8 drives the order on a desk and on a phone, for a
member the New link page lets in and for one it turns away, across loads; the evening before the final
week; the final week's first load; and the start and end dates. `e2e/calendar-notices.spec.js` runs the order
across real reloads, and the final week on a touch screen.

## The Pay page's second notice: estimate last year's Holiday Pay Premium before January (owner, 16 Nov 2026)

**Decided (owner, 16 Nov 2026):** a one-time Pay Calculator notice (`hpp_2526`) asks members to estimate
the Holiday Pay Premium the January 2027 payslip will carry — the premium for 2025/26, a year the
calculator holds no hours for because it did not exist yet — from the Year to Date Taxable Pay on their
last 2025/26 payslip. It is the SECOND Pay notice, after the Year to Date notice (`ytd_2627`), and runs
from 16 November 2026 to 8 January 2027.

**What it does, and why each part.**
- **One load after the Year to Date notice, never the same one.** It reads that notice's flag as it is
  wired (the Calendar's FOLLOWS rule), and the page opens both through one opener in that order. The Year
  to Date notice ends by ~26 November, so this is never held behind it for long.
- **Only for the member it is for** (`premiumStillToEstimate`): a 2025/26 payslip — asked of the year's
  LAST pay period, so a member who joined part-way through is included — and no figure of their own for
  that premium yet. A joiner whose first payslip came in 2026/27, or a member who has already estimated
  it or typed it in, never sees it — and it is not flagged for them: the flag belongs to the device, so a
  colleague who signs in on the same phone afterwards still gets it. An hours estimate from part of
  the year does not count as done: the route the notice teaches may well be the better figure.
- **Its link opens the payslip, not just the page:** `?payday=2026-03-13#payslipCard`, the existing deep
  links, land on the 13 Mar 2026 payslip with the Year to Date card open. The second step — choosing
  "Rough estimate from your Year to Date pay" in the Holiday Pay Premium card — is the member's, named in
  the notice in the card's own words. Choosing the source for them was considered and left out: a notice
  writing a member's pay settings is a new kind of coupling, and the card already shows the rough figure
  beside that option once the Taxable Pay is in.
- **It ends on 8 January 2027**, the day before the January payslip's cut-off. From then that payslip can
  be in hand, and the box under "Last year (2025/26)" takes the real figure.

**And the card now says what the 2025/26 figure cannot take out.** The 16 Jan 2026 payslip carried the
2024/25 premium, which sits inside the 2025/26 Taxable Pay, and no tax year on record holds that figure.
So it stays in — 7.69% of it lands in the estimate — and the card says the figure "may be a little
high", the rule the back-pay lump already follows (owner, 10 Nov 2026): named, never guessed. A box for
last January's premium would take it out exactly; that is a separate decision, not made here.

**It still goes to a member who filled 2025/26 from the calendar** (owner, 18 Nov 2026: asked and
kept). A calendar fill is an hours estimate, which the rule above already says does not count as
done, and the notice's words were corrected on 18 Nov 2026 so that they are true for that member too.

## The guides read at the app's sizes, on screen only — and the rest of the 16 November consistency check (owner, 16 Nov 2026)

**Decided (owner, 16 Nov 2026, "Do all", v26.24):** all four fixes from a whole-app consistency check,
with the guides at 14px (offered 14px or 13px). The check captured all 14 pages at 390px and 1,280px,
measured what the browser drew, and dropped every difference already decided on record.

**What changed.**
1. **The five guides read on the app's three steps**, on screen: 14px for reading, 13px for anything
   dense (boxes, card rows, tables, keys), 12px for sources and sub-lines, under the app's own token
   names in `guide-shell.css`. They had run from 10.5px to 15px, and four of the five read smaller than
   the app. Reading text moved from grey to the text colour; Rangers' and FIP's sub-headings became the
   app's card title; every guide starts its first line 20px below the chips (it was 14 to 22px). Nothing
   on record had chosen the old sizes: the guides load none of `shared.css`, so each was typed by hand
   and nothing compared one guide with another — the gap v25.84 closed for the section headings.
2. **Pay's "Fill from calendar" is 15px on a phone**, the size of every main button on the page. It was
   12px there and 15px on a desktop, where it had been raised on purpose as "the obvious first action".
3. **Operations' group labels are `h2` headings**, as Settings' are. They looked the same and read
   differently: a screen reader's list of headings named Settings' groups and none of Operations'.
4. **The show-more buttons on Pay and Trains wear the button corner** (12px, `--radius-button`), not 8px.

**Why screen only.** Every printed sheet was composed at its own sizes — the Staff Guide prints on one
with a few pixels to spare — and the check found nothing wrong on paper. So the sizes live in one
`@media screen` block at the end of each guide's stylesheet, and a test reads a sample of each guide on
paper as well as on screen.

**What it costs.** The Railcard, Staff and Pay guides are longer to scroll. The Pay guide's rate cards
went to one column on screen, because two to a row left each about 120px of text at the new sizes and a
description ran to nine lines; paper keeps two.

**What the bigger words broke, and the fix.** A larger word raises the narrowest width a block can
take, and under a larger text size on a phone the Staff Guide ran past the screen: its Shift Types
table by 17px on a 360px phone at 1.5× and 2px on a 375px one, and its tips' grid on a 320px one (the
browser suite caught the 375px case; a sweep of all five guides at 320–412px and 1–1.5×, against
main, found the rest). The table's middle column may now break a long word, which at the default size
changes nothing at any width, measured; and the tips stack as the badge key above them already did,
under one rule for both grids. A 320px phone therefore shows the tips in one column at any size, as
it did the badge key. After the fix the Staff Guide runs past no width in the sweep, where main ran
21px past a 320px phone at 1.5×; the Rangers guide's pills and FIP's 2px at 320px were there before,
and v26.26 fixed them too (below).

**The rest of the large-text sweep, fixed in v26.26 (owner, 16 Nov 2026: "Fix all").** The same sweep
— all five guides at 320–412px under 1, 1.3 and 1.5× text — found two more things running past a
phone's edge, both older than v26.24:
- **The Rangers guide's status badges** ("✓ National Rail checked · Aug 2026") were `nowrap`, so a
  badge wider than the card ran 43px past a 320px phone at 1.5×, 3px past a 360px one and 2px past
  320px at 1.3×. A badge may now wrap its own words, which it does only when it alone is wider than the
  column: at the ordinary size every badge is still one line at every width, and the page renders
  byte-identical to v26.25 at 320, 360, 390, 768 and 1,280px. Three details make the wrapped badge
  read right: a 1em corner (identical on one line, a rounded rectangle on two — 999px made a bubble),
  `&nbsp;` keeping a month with its year and the "·" with the word before it, and the key's badges never
  shrinking — a key row is a flex row, and without that the short "✓ checked" broke onto two lines at
  the ordinary size.
- **FIP's "Amsterdam/Rotterdam/Antwerp"** is one 292px word, and the Eurostar box had 260px for it at
  1.5× on 320px. It takes one `<wbr>`, after "Rotterdam/". Five `<wbr>`s (after every slash) were tried
  first and re-broke the sentence at the ORDINARY size on a 320px phone, because line-wrapping uses a
  `<wbr>` wherever it helps, not only where a word cannot fit; with one, every default line is as it was.
  A `<wbr>` also splits the line into two shaping runs, so the glyphs after it move by a fraction of a
  pixel — invisible, and below the 6,200px the FIP screenshot baseline covers.

After both, the sweep finds nothing past the edge on any guide at any of its 4 widths and 3 sizes.

**Checked and left as they are, so not re-raised:**
- **The Calendar's header on a phone** differs from the other pages' — kept (owner, 8 Nov 2026); from
  768px it is the same header, and a test holds that.
- **The guides' two background greys** — kept apart in v25.84, or the Railcard's Marylebone panel and
  the Rangers quick answer would vanish into the page.
- **Two overlay styles** — dark glass for About and the notices, white for sign-in and Tips — by design;
  and Pay's 10px small print is deliberate.
- **The Link Designer generator's boxes** measure 13px on a desktop and 16px on a touch screen, which a test holds.
- **Trains' "Change station" and the grid's "Show every station" stay pills** — they act rather than
  reveal (`trains.css`), so the show-more corner does not reach them.
- **Labels, pills and tags, card names and figures, the app's badges drawn in a guide, and controls**
  keep their own sizes; the three steps are for reading.

**What holds it:** `e2e/guides.spec.js` reads every word of every guide on screen against the three
sizes, with the exceptions named (`KEEPS_ITS_OWN_SIZE`); reads a sample of each guide on paper; compares
a guide's sub-heading with the app's card title; measures the top gap at 390 and 1,280px; and reads the
Staff Guide at 375, 360 and 320px under 1.5× text ("enlarged text does not widen the column past a
phone"); since v26.26 it reads every element and every run of text on all five guides at 375, 360 and
320px under 1.5× and 320px under 1.3× ("enlarged text runs nothing past a phone's edge"), and holds the
Rangers badges to one line at the ordinary size and a clean wrap under large text (five mutations, each
caught by its own assertion: the key's no-shrink rule removed, `nowrap` back, the 999px corner back,
FIP's `<wbr>` removed, a month's `&nbsp;` removed). `e2e/paycalc-calendar-fill.spec.js` sizes the calendar button against the page's main buttons at four widths
and checks that its longer label never clips. `e2e/trains.spec.js` and `e2e/paycalc-calendar-fill.spec.js` read the
show-more corners; `card-header-parity.test.mjs` requires the canvas group labels to be `h2`s on both
pages. Thirteen mutations — an off-scale sub-line, the sizes reaching paper, the sub-heading's weight, a
guide's own top margin, two pay columns, a print size removed, the button at 12px, both 8px corners, a
`<p>` label, the table's word-break rule removed, the tips' grid taken out of the stacking rule, and the
Railcard guide's screen sizes reaching paper — each failed its test.

## The 55-hour row takes a cover week at its worst, as every run does (17 Nov 2026)

**Decided (17 Nov 2026, under the owner's "do all" on a whole-app review):** the Link Designer fatigue row "More
than 55 hours worked in any 7-day period" takes its verdict on a cover week's WORST case, as every run
rule in the panel already does ("A cover week is an unknown, not a no", `.claude/rules/link-designer.md`).
It took it on the FLOOR — a cover week counted as no hours — so Balanced V6 read CLEAR at 50.9 hours
while one of its cover weeks falling badly comes to over 60, and Link Designer's Design checks counted 3 factors
present where the New link page, built from the pack's worst case, counted 4. Members can read both
during the consultation.

**What the worst case is.** Each worked day of a cover week counts as a quarter of the contracted week,
8h 45m (`COVER_DUTY_MINUTES`, link-designer-fatigue.js): the app already counts a cover week as the contracted
week (the hours row, owner), and it is worked as four duties. The four fall on Monday to Saturday,
placed as badly as each seven days allows, and the Sunday is worked as overtime on top — the bounds the
run rules keep. The Sunday counts the same 8h 45m: one stated assumption rather than two.

**What the row shows.** The worst case is the figure, and the sentence gives both — "61.2 hours in the
worst case, and 50.9 on the duties the rota fixes" — with the assumption. It is never CLEAR while the
worst case crosses 55. With no cover week the two figures are one, and nothing is said.

**The New link page and the pack.** The page's counts now match the Design checks for all three
shortlisted designs (Balanced V6 4, Level Crossing 0, Middle Ground 1). The pack's own worst case takes
a cover duty as 8 hours (with 8h 45m and an 8-hour Sunday beside it), so its printed figures are a
little lower than the app's — 58h 35m and 60h 30m where Link Designer says 61.2 for Balanced V6 — and the two
agree on every verdict. The pack was NOT regenerated: its tables keep their own split, the duties the
rota fixes and then "up to", so `report-data.mjs` reads the row at its floor for them, and every sheet,
deck and figure on the page is what it was.

**What it costs:** a design with a cover week shows one more factor present wherever its worst case
crosses 55 — Balanced V6 and Middle Ground on the shortlist. The "today's link" row is unchanged: today's
main cycle is over 55 on its fixed duties already.

**What holds it:** `link-designer-fatigue.test.mjs` (four of Monday to Saturday and never six, the Sunday on top,
the placement the pack's blocks reach, each week's own four across a lap, both figures in the
sentence) and `newlink-data.test.mjs` (every count the page states is the Design checks' count for the
same rota). Taking the verdict on the floor again fails both; dropping the pack's floor reading makes
the generator count the week twice, which the same file's first test catches.

## Christmas Day and Boxing Day are never spare days (owner, 19 Nov 2026)

**Decided (owner, 19 Nov 2026):** "Christmas days and Boxing days cannot be spare days even if they
fall in a usually spare week." Asked what a spare week's 25 or 26 December should then be, the owner
chose a REST DAY over Christmas leave. So from Christmas 2026:

- A member whose pattern is SPARE on either day is not due at work there (`isChristmasLeaveDay`,
  `christmas-leave.js`): the Calendar shows Rest, no Christmas leave is listed, and working Boxing Day
  from a spare week is overtime from a rest day, earning no day in lieu. A SHIFT on the pattern still
  gets the leave and the day in lieu, as before. That was 9 people on 25 December 2026 and 7 on the 26th.
- A Spare turn cannot be recorded on either day, in any year: Admin's week grid turns the Spare chip
  off (and on Boxing Day, which already refused Other days, the whole Other pill), and the Save
  refuses one (`checkDayRules`). The roster import shows a SPARE printed there as a row that records
  nothing (`christmas-spare`, `normaliseCellValue`), never as a change to tick — over an earlier
  import, an unticked "Back to normal" row instead (20 Nov 2026).
- **A Spare saved there before Save refused one is not drawn** (owner, 20 Nov 2026: "Fix"), in any
  year: the day shows what it would be without it — Rest, or Christmas leave for somebody due at work
  (`isOverrideDisplaySuppressed`, whose `christmasDay` input every caller must pass, so the typecheck
  fails one that forgets). Admin still draws the record, so it can be removed: its pill, off on that
  day, is on for that one act (`_onToRemove`, `admin-week-row-state.js`), as for any saved record a
  day no longer takes — and on 25/26 December the Other chips behind it are off too, a kept draft cannot
  put a choice back on it, and the row says the Calendar does not show the record.

**It replaced** the 5 Nov 2026 rule that a spare day counted as due at work there, and it answered the
ROADMAP question of whether a Spare turn on a Boxing Day earns a day in lieu: there can be no such
turn. **What holds it:** `christmas-leave.test.mjs`, `roster-cell-rules.test.mjs`,
`admin-roster-upload.test.mjs`, `admin-shift-rules.test.mjs` and `admin-day-pills.test.mjs`; deleting
each guard line fails them.

## An "Other staff" login: the staff PIN's view under a person's own name (owner, 23 Nov 2026)

**Decided:** a grade for people with no roster of their own and no manager or admin rights. They sign in
individually and see what the staff PIN shows, plus their own Settings (owner's choices: "PIN view +
Settings", the grade named "Other staff" in the sign-in list, the same 60-day session as everyone, and
the PIN kept for now). The owner's direction is to **phase the PIN out**; this is the first step, and
retiring the PIN is a separate change once everybody who uses it has a login of their own, so nobody is
locked out on the day. **That change was decided the same day** — "The staff PIN retired", below. Also
the same day, the grade was renamed **"Other Staff"** (capital S) in the sign-in list, the role string,
Operations' filter and the server's list; this heading keeps the original wording.

**How, and why that way.** The row is a `teamMembers` entry like a manager's (`hidden`, picked by its own
flag), so the sign-in, the server's account list and Operations all reach it through one function,
`signInMembers`. The account is a **plain member**, not a new claim tier: a member can already read the
roster and write only their own records, and that is the access this grade needs, so the security rules
did not change and there was no backend-first release to order. What the grade TAKES AWAY — Admin, Pay,
Overtime, Link Designer, New link — is the client's page policy (`otherStaff` in `PAGE_POLICIES`) and one drawer
gate (`isNotOtherStaff`). That is UX, not a boundary, and it does not need to be one: a member opening
Admin by its address could only record leave against a roster they do not have.

**Not chosen:** a new `viewer` claim with its own rules. It would have made the rules the boundary for
something no rule needs to stop, at the cost of a rules release, a Functions release and a second claim
for every write path to reason about.

## The staff PIN retired (owner, 23 Nov 2026)

**Decided:** the shared four-digit staff PIN goes. Everyone signs in under their own name; somebody with
no roster of their own gets an Other Staff login (the entry above), which gives them the view the PIN
gave. The PIN was a barrier, not authentication — one code for the whole station, recording nobody,
and the only remedy for one leaver was rotating it for everyone — and with a per-person route for every
kind of colleague who used it, it no longer earned its place.

**Three releases, in this order, never one push** (the deploy workflows fire in parallel, and this
tightens a read rule — RECOVERY_RUNBOOK.md → "Tightening a read rule — the order"):

1. **Client.** No PIN anywhere in the UI; only a named sign-in opens the Calendar and Trains. A device
   still holding a PIN session is signed out on its next Calendar or Trains load, and its sign-in card
   says the PIN has been retired. The notice audiences that existed for signed-out readers
   (`'signed-out'`, `'everyone'`) go with it: every notice is for members. **Kept for now:** the
   transition code that tears a live PIN session down safely (AUTH_AND_SESSIONS.md 8 — the viewer
   check, the sign-out before persistence is restored, the viewer branch of `authReady`) and the
   Operations PIN-lockout card, because the endpoint it reports on is still deployed.
2. **Server**, once the client has soaked. **Shipped.** The rules drop `isCalendarViewer` (and the
   `viewerAttempts` block); `unlockCalendarViewer`, `functions/calendar-viewer-auth.js`,
   `functions/pin-lockout.js`, the `CALENDAR_VIEWER_PIN` binding, the viewer door in `getDocumentUrl`
   and the Operations PIN-lockout card are deleted. The Functions deploy runs `--force`, so leaving
   the export is what deletes the function. **The signed-in lane went in the same release**:
   `scripts/signed-in.mjs` no longer requires `CALENDAR_VIEWER_PIN` or passes `E2E_VIEWER_PIN`, and the
   leftover-PIN-session journey (`e2e/signed-in.spec.js`) now mints its session as the endpoint did,
   through the Auth emulator (`leftoverPinToken`, `e2e/signed-in-setup.mjs`) — kept, not deleted, because
   the teardown it proves stays until release 3. **Kept on purpose:** the server's refusal to adopt the
   shared account (`functions/retired-viewer-account.js`), because the account outlives the
   endpoint until step 1 below, and a session left open on it can still link an email to it. Then
   the manual steps — delete the `calendar-viewer` account, destroy the secret, purge
   `viewerAttempts`, consider switching off Anonymous sign-in, and KEEP the token-creator grant
   (`getDocumentUrl` needs it): OPERATIONS_REFERENCE.md → "The staff PIN (retired)".
3. **Cleanup**, once the account is deleted: the transition code goes, and the server's account
   guard with it, because no PIN session can exist any more. **Shipped** (27 Nov 2026), the day after
   the owner deleted the account, destroyed the secret and purged `viewerAttempts` — not a week or two
   later as first planned: with the account gone no device can renew a PIN session, so the wait would
   only have kept the one line telling a station the PIN had been retired. That line went with it.

**Between releases 1 and 2 the PIN still worked at the endpoint** — a person holding it could read the
roster by calling it directly — so release 2 was not to wait long. Rotating the PIN in that window was
not worth doing; shipping release 2 was.

**Not chosen:** keeping the PIN on Trains alone (its timetable is public — the reason it was admitted on
22 Oct 2026). A station PC that signs in by name reaches Trains the same way, and one shared code kept
for one page is still a shared code to rotate. **Not chosen either:** removing everything in one
release. A device holding a PIN session when the rules stopped accepting it would show a roster under
a "Couldn't update" chip, and a cached app would keep offering a PIN box that could not work.

## What ROADMAP_HISTORY.md held that still binds (25 Nov 2026)

`ROADMAP_HISTORY.md` — the archive of shipped phases, closed limitations, reverted experiments and
dated reviews — was deleted on 25 Nov 2026: git holds the past, and a 363 KB archive beside the live
documents is a fact kept twice. **Its full last text is `git show 28b217d0:docs/ROADMAP_HISTORY.md`.**
Every decision in it that still binds was checked against the live documents first; those already
recorded elsewhere stay where they are (the avatar, cultural calendar and five-stage password lines
above; the 60-day session, the leave figures in git history and the real-payslip fixture in
KNOWN_LIMITATIONS.md; the Huddle not being printed in OPERATIONS_REFERENCE.md; the fast path in "The
provisional paint"; the login freeze's lessons in AUTH_AND_SESSIONS.md → "The login freeze"). These had no other home:

**Tried and held back — the UX experiments.** Each was prototyped, assessed or built, and reverted.

- **FIP faceted filtering — WON'T DO** (Jul 2026, v19.10). The search half already shipped (v17.64: the
  country finder matches operator and train names). Filtering by PROPERTY ("which countries need a
  supplement?") cannot be done by free text — `supplement` matches Ireland's "**No** high-speed
  supplements" — and done properly means tagging each card, and **every tag is a factual claim** that
  needs a `GUIDE_SOURCES.md` row: ~50–75 claims to source and re-review annually on the page where a
  wrong fact strands somebody abroad. **Reopen on evidence that staff ask property questions of the
  page**, and then tag only a few decision-changing properties. Three other FIP v2 ideas were not
  shipped for the same family of reasons: per-card reliability badges (a "Confirmed" tier over-promises
  against the register's "sampled, not certified" posture), per-section review dates (already per row
  in the register) and collapsible major sections (the finder and chip bar carry navigation).
- **Bottom navigation bar — do not revisit.** Prototyped v7.66, reverted: the drawer covers cross-page
  navigation, a fixed bar costs ~50px of the Calendar grid, and it would fight the Pay Calculator's
  sticky take-home bar. Reconsider only if a page arrives that does not fit the drawer.
- **Glanceable summary strip — held back.** Prototyped v7.66 (Today · Next RD · Leave left · Payday),
  reverted: on a phone the grid is the information, and each chip is already reachable. **Revisit if**
  staff want a "what am I doing today?" glance — and then inside the controls card, not between it and
  the grid.
- **Calendar cell type hierarchy — held back.** v11.57 made the shift badge primary and the date
  quieter (14px/500); reverted, because the date is how a month is scanned for rest days and leave.
  **The date number is decided** (`index.css` cites this). A revisit compares both sizes in real daily
  use, and considers a middle step (16px/600) rather than the full one.

**Considered and dropped.** A Daily Huddle history viewer — the Huddle's value is the day's duties, not
browsing. A global `scroll-behavior: smooth` — it changes scroll feel app-wide for marginal benefit.
The sub-44px ✎/✕ chip buttons (`link-designer.css`) and `.roster-tick` (`operations.css`) stay as they are:
mouse-driven admin and designer surfaces, where equal 44px hit areas on adjacent controls would overlap.

**The service worker: ONE for all pages.** Two workers sharing one scope competed and wiped each
other's caches (v6.50–v7.07). `.claude/rules/pwa.md` carries it.

**The Link Designer's founding choices** (v12.06–v12.47), beside the patterns-only documents
KNOWN_LIMITATIONS.md already records: a SLOT-based generator rather than an early/late binary, because
the station is staffed in waves (28 distinct start times, distinct Saturday and Sunday); and an
HOURLY heat map rather than a bar chart per shift type, because it shows the real on-duty shape and
its gaps.

**Load speed — measured, and deliberately not done** (June 2026; the later measurements are
`LATENCY.md`). Measure a cold load in a private window (Lighthouse mobile, throttled): the installed
app hides the cost.

- **Lazy-loading the Firebase SDK off the Calendar's first paint — deferred.** It needs
  `calendar-overrides.js` split, `nav-panel.js` lazy-importing Firebase and the Calendar's start
  restructured; the SW cache already serves returning staff instantly; it is high-risk on the two most
  used surfaces; and the e2e suite stubs Firebase, so no gate could validate it. **Only if a cold-load
  profile shows the SDK dominating, on a dedicated branch with real-device checks.**
- **Lazy-importing Firebase in `nav-panel.js` ON ITS OWN is worth zero** — every page reaches the SDK
  through other static imports — so it is meaningful only bundled with the restructure above.
  Reviewers keep suggesting it; it was declined again in the v15.69 review.
- **Lazy-loading Operations' card imports — declined**: an admin-only page almost nobody opens. Reopen
  only if Operations becomes staff-facing.

**Usage analytics are first-party, in Firestore** (v14.14) — **never Google or Firebase Analytics**,
which would breach `script-src 'self'` and send staff data to Google. Counts are per account-device, a
trend and not a headcount; a device-independent unique count would need server-side identity and is
deliberately not built.

**Two refactors refused, one left half-done on purpose.**

- **Splitting `roster-data.js` — REJECTED** (Jul 2026): the payoff is smaller files, the blast radius
  is every importer, the SW precache, the preload graphs and `APP_VERSION`. Revisit only if it becomes a
  real pain point (frequent conflicts, a section needing independent testing) or a build step is
  adopted. Data tables may still move out on their own merits, re-exported, as `teamMembers` and the
  cycle patterns did.
- **The CommonJS/ES-module duplication** is left alone: parity tests cover it, and the surname
  passwords it serves retire with security Track C.
- **A "Phase 10" removing the duplicate post-login `ensureNamedSession` — not built**: the
  `auth.currentUser` fast path makes the second call a near no-op. If ever built: Admin and Settings
  only, the in-place path only, with tests that no write meets a stale `auth.currentUser`.
- **The ~180 remaining `@type {any}` casts are deliberately kept** (v16.29): ~56 are genuinely dynamic
  (Firestore data, caught errors); the rest want a shared `@typedef` such as a `Period` type, which is
  a focused pass of its own if it is ever done.

**From the v23.01 external review (6 Sep 2026).** **Freezing Calendar and Team View aesthetics —
DECLINED (owner, 19 Sep 2026).** A freeze whose exceptions are "a reproduced defect or an
accessibility finding" would have permitted every change in the sequence it was proposed against (the
last week unreachable below ~825px, then two contrast failures the fix exposed), so it would buy
nothing while discouraging the look that found them. **Revisit if a change lands there that is polish
and nothing else.** **A Huddle's TEXT is confidential — DECIDED 7 Sep 2026**: the Huddle, the Circular
and the Newsletter are not readable without a sign-in (the client first, v23.17,
`calendar-doc-access.js`; the rules at v23.18). Link Designer already in circulation are EXC-007.

**From the print review (7 Sep 2026).** **A running footer on printed guides — WON'T DO, on evidence**
(v24.06): Chromium implements no `@page` margin boxes, a `position: fixed` footer is clipped at the
page area and cannot sit in the margin, and inside the page area it printed across a sentence. The
shape that would work is an in-flow marker on each country card (23 of 25 FIP sheets), which changes
every card on paper and so is an owner decision, not a follow-up. **Rendering is the check**: a
positional test over the PDF's text boxes called the overlapping page "1.7pt clear". Also not done and
not recommended: printing the whole Operations or Admin page, and a version stamp on the printed
Calendar, whose header already names the app, the member and the date.

## The new CEA link: what the December 2026 plan settled (owner, Aug–Nov 2026)

`LINKS_DEC2026_PLAN.md` — the research, readiness dashboard and build record for the new CEA link —
was deleted on 26 Nov 2026, its work shipped. **Its full last text is `git show
16386f9b:docs/LINKS_DEC2026_PLAN.md`.** What is still open is `ROADMAP.md` → The new CEA link. The
rules every design is judged against are `docs/links-26/RULES.md`; how the workspace is built is
`.claude/rules/link-designer.md`. Decisions already argued in a module header or that rule file stay
there (the FF18 cadence reading, a spare week as four duties of seven, the 13-day limit and its
withdrawn Hidden origin, the uplift control, demand weighted by cars, the run cap's trade). These had
no other home:

**"Dec 26" means the December 2026 TIMETABLE CHANGE**, the industry's shorthand, not 26 December.
Boxing Day rules in `roster-data.js`, `christmas-leave.js` and `OTHER_DAYS.md` are unrelated.

**Who leads (owner, 4 Nov 2026).** S. Silva, as the RMT rep, leads the roster change. The shortlist
was settled by her and the developer together from colleagues' feedback; she holds a vote on it and
makes the final call on which proposal goes to the Marylebone area manager for review. The developer
built the tool and the pack and is in charge of neither the change nor the choice. **What colleagues
read is deliberately vague about this process** (owner: "It is deliberately vague"): the New link page
says who leads the change and no more, and the pack need not say even that. **This paragraph is the
record of the process: do not carry it into the page or the pack** (`newlink-config.js` header;
`newlink-config.test.mjs` and `e2e/newlink.spec.js` hold the wording).

**What drives CEA headcount (owner, Aug 2026): posts, not trains.** The station rosters posts —
ticket office, gateline, passenger assist, lost property (daytime Mon–Fri) — plus extras to cover
breaks, and a post is staffed whether its hour carries 23 movements or 5. So the existing link,
which already covers the posts, is the baseline, and **the measured service is EVIDENCE shown beside
the cover, never a target**: no CEA-per-train ratio exists, and the tool must not invent one.

**The staffed window (owner, Aug 2026)** is Mon–Sat 06:20–23:55 and Sunday 07:15–23:25
(`DEFAULT_WINDOW`, `link-designer-window.js`); post-midnight trains are outside the link by design.
**No duty runs past 23:25 on a Sunday** (owner, 28 Sep 2026: agreed practice, and it will remain so),
so the five later Sunday movements (23:27 dep, 23:35 arr, 23:45 dep, 23:51 arr, 23:54 arr) are stated
on every design as a neutral fact, never a finding. Saturday shares Mon–Fri's window; the setting can
split them if that ever changes.

**The staffing requirement was confirmed verbally (owner, 29 Sep 2026)**, and the contracted-week
question with it: the work that fills a widened link comes from the December 2026 staffing, not from
making today's lines denser. Every extra duty comes out of a rest day, so a service increase cannot be
absorbed by the existing lines — the link has to get bigger, which means more staff. That is why the
generator refuses a table that misses the contract in either direction, and why the uplift control was
declined (owner, Aug 2026: "over complicates it"; `.claude/rules/link-designer.md` → No uplift control).

**Re-measuring from a new timetable file** meets two traps that each failed silently once: a `+` in a
time (`05+46`) marks an empty-stock move (all 53 such movements carried a `5x` headcode), and five
weekday times were stored as Excel serial fractions, which the first parse dropped (311 movements, not
306). Platform occupancy is not computed — a known limit of the demand curve, not a blocker.

**Not built: an automatic optimiser.** The generator produces a compliant skeleton; which duties fit
the service is the designers' judgement. The tool checks and shows; it does not decide.

## The annual leave uploader: a session makes the file, the app checks and adds, nothing removes (owner, 14 Nov 2026)

`AL_UPLOADER_PLAN.md` — the plan of record for Operations → Annual leave sheet — was deleted on
26 Nov 2026, Phases 0–2 built (v26.11, v26.13). **Its full last text is `git show
16386f9b:docs/AL_UPLOADER_PLAN.md`.** What is open — Phase 3 — is `ROADMAP.md` → Annual leave
uploader. What was built, and why each rule holds, is in the modules' headers: the file and its seal
`al-leave-file.js`; the session's method `scripts/make-leave-file.mjs`; the day states
`al-leave-compare.js`; what a Save writes, the log's meaning and the Undo's mark `al-leave-plan.js`;
the checked writes `al-leave-save.js`; the card `operations-al-sheet.js` and `operations-al-save.js`;
the log's fields `DATA_MODEL.md` → `alUploads`; the procedure `OPERATIONS_REFERENCE.md` → "Checking
the clerks' leave sheet against the app". These had no other home.

**The phases**, as the code comments name them: **0** the format module, the session's script and the
privacy guards; **1** the card's check, writing nothing; **2a** the upload log's rules, shipped
backend-first with nothing writing to it; **2b** the Save, its receipt and its Undo; **3** (not built)
ticked conflicts, Sunday corrections and the roster review naming workbook leave.

**The shape: two stages and a strict file between them** — an *anti-corruption layer*, which stops a
messy outside system's quirks leaking into the app. A session does all the judgement on the clerks'
workbook; the app does all the writing, from a file so strict it can refuse anything that does not fit.
Not chosen: **the app reading the `.xlsx`** (a browser spreadsheet library is a discuss-first decision
under the no-build rule, and every quirk of the workbook would become app code that must be right with
nobody watching); **a Cloud Function asking a model to read it**, as the roster PDF is read (the
workbook's ambiguities need a person's answer, not a better prompt). The chosen shape also keeps the
raw workbook, which covers every location and carries comments about named people, off the app's
servers. **One format module serves both stages** — Node can import it, and no CI lane runs Python, so
a second implementation would have been tested against nothing. Of `AL_WORKBOOK.md` §11's three
conditions, the over-quota column readable without a human was **deliberately waived**: a person stays
in the loop instead, and the session asks about anything it cannot place.

**The owner's decisions** (14 Nov 2026, "do your suggestions"; code comments cite them by number):

1. Build the check first, and decide on the Save after using it — approved the same day; built.
2. **The name map is carried in the leave file** (`nameMap`), read back by the next session; it is
   never committed, because its exceptions are personal facts.
3. **The workbook is the authority for ADDING leave — never for removing it.**
4. **The clerks' copy may be 14 days old** (`LEAVE_FILE_MAX_AGE_DAYS`): older, the check still shows,
   because a check cannot do harm, and the Save refuses.
5. Leavers' past leave is skipped: listed as not compared, never written.
6. **A hand-edited file is refused** by its seal; a correction goes back through a session.
7. Upload whenever a copy comes, with the age limit as the backstop.
8. Whether the roster review should prefer the published roster over workbook leave — **decided when
   Phase 3 comes** (`ROADMAP.md`).

It has **its own card on Operations** (owner, 14 Nov 2026), separate from the weekly roster upload.

**Removing leave the sheet lacks is not planned** (the owner confirmed it). Every way of deciding it
is weak: `createdAt` is the last write, not when leave was booked; a person with undated over-quota or
carried days cannot be judged from dates; removing leave stamped `replacedType: 'shift'` destroys the
only record of a swap; and a removed day a roster import wrote comes back, ticked, on that week's next
import. App-only leave is shown, and removed by hand in Admin if it should go.

**RDW, an Other day or a Spare turn is never overwritten by an upload** — deliberately unlike the
Admin range card, which writes free leave over them inside a range a person chose. In an upload nobody
chose the day, and overwriting worked RDW removes evidence of pay.

**What it deliberately does not do, and why:** change anyone's allowance (allowances are code,
`proRatedAL`, transcribed in a session; a mismatch is reported); write the override's `note` field,
even to record where a day came from (it stays empty by an earlier data-protection decision, and
reusing it would block its planned removal — the upload log records provenance instead); give uploaded
leave a new `source` value (a rules change, and every reader of `source` would have to learn it, for
information the log already holds — it can be revisited in Phase 3); write for leavers, managers or
anybody not in the app; or guess a name, a date or a year.

**Three of `AL_WORKBOOK.md` §10's questions went ahead on defaults that only narrow what is written**:
Q3 (duplicate rows — the script asks about differing duplicates, so the Save never meets one
unanswered), Q7 (column E — only dated days are written, never an undated lump) and Q8 (who saves the
file — the older-copy refusal trusts the clerks' save time, and "removed since" protects either way).
An answer that differs changes the script, not the Save's guards.

## The installed app stays signed in (owner, 26 Nov 2026)

"If it is on someone's personal mobile, why am I asking them to sign in every 60 days. Makes sense on
desktop I think." The 60-day limit protected nothing an account depends on: a leaver's disabled
account, an admin reset, a sign-out and the claim sweep all end access at once, whatever the timer
says (KNOWN_LIMITATIONS.md → the 60-day session). So:

- **In the app installed on a phone, a session renews on each open** (`renewWhenServerVouches`,
  session.js) — once the member's own account is restored AND the server has issued its token within
  the hour, so a disabled account stops renewing within that hour. A browser tab or a desktop keeps
  the fixed 60 days: the owner's choice ("Makes sense on desktop I think"), not a shared browser,
  since each colleague has their own Windows login on the station PCs ("Shared office PCs", above). The work phones are one person each (owner),
  so they count as personal. Invariant: AUTH_AND_SESSIONS.md 2.
- **"You should still be made to reset the surname password"** (the owner's condition): the
  set-password step now asks on an ordinary open as well as after a sign-in, asking for the current
  password up front, so it no longer waits for a session to run out (password-force.js).
- **Rejected:** renewing everywhere (the owner kept the desktop on 60 days); a shorter session for everybody to cover the admin's phone (see
  "No password check before admin actions", below).

## No password check before admin actions (owner, 27 Nov 2026)

Proposed as Track F of the security plan: the server would refuse a password reset or an account
change from Operations unless the admin had entered their password in the last 15–30 minutes, because
a long session means a phone picked up while unlocked could reset a colleague's password. **Declined**:
"My phone unlocks with a fingerprint and relocks with a power button press. There is no need to do
this. It can also be deleted remotely if lost." The phone's own lock is the control for an unattended
phone, and a lost one is wiped remotely — and an admin reset of the admin's own account still signs
every device out (AUTH_AND_SESSIONS.md 23). Not to be re-proposed on the same argument. If it is ever
reopened (for example a shared admin device), AUTH_AND_SESSIONS.md 16 holds the one rule: the server
reading the token's `auth_time`, never a client timer.

## The Links Selector puts a proposal on dates (owner, 27 Nov 2026)

Colleagues asked to see a proposal as a calendar: choose a shortlisted proposal and the line you would start on, and see
your months as the Calendar shows them, with its swipe. The New CEA Link page deliberately shows the same proposals as
WEEK NUMBERS, so a proposal is never read as somebody's roster (`newlink-boundary.test.mjs`); this page does the
opposite on purpose, and is made unmistakable instead — its own name and colour, a "A proposal, not your roster" line
above every month and in every day's panel, and no recorded change, leave or absence drawn on any day ("Leave out").
The owner's calls: the name **Links Selector**; a provisional start of **Sunday 17 January 2027**, with every day before
it **blank** rather than today's link; reached from the drawer; a **beta for the admin alone** until it is right, then
**the New CEA Link page's audience** — one switch, `CONFIG.LINKS_SELECTOR_OPEN`, turned on at v27.27 (owner, 28 Nov
2026, after two audits and a first-visit explanation, the `?` panel).

How it is built, so it is not rebuilt another way: the month is assembled from the Calendar's own cell builders and
drawn by `index.css`, so it looks exactly like the Calendar and follows any change to it; it does NOT go through
`buildCalendarContainer`, which draws a member and their recorded changes (`links-selector-render.js` says why). The
swipe is the Calendar's own module, handed the page's months through its `months` option, which the Calendar leaves
unset. The rotation is the app's: the line chosen in the week of the start, one line down each Sunday, back to line 1
after line 26 (`links-selector-core.js`). Nothing reads or writes Firestore for the roster.
