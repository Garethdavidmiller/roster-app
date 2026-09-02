# MAINTENANCE_CALENDAR.md — dated obligations

*Created August 2026 (at v19.97), external review. Not version-stamped; not a runtime asset.*

**This is the work that has a deadline whether or not anyone plans it.** It was scattered through
KNOWN_LIMITATIONS.md prose and GUIDE_SOURCES.md rows, which is the wrong place for it: those files
are read when investigating something, and a tax-year rollover is not something you investigate — it
either happened in time or it did not.

**Every row carries a WARNING POINT earlier than its deadline, deliberately.** "Must be done by
6 April" reliably becomes "started on 4 April". The warning date is the one to diary.

Nothing here is optional and nothing here is a feature. Product direction lives in `ROADMAP.md`.

**Rows cite stable IDs rather than restating them.** `VAL-*` rows live in `VALIDATION_REGISTER.md`
(a claim the app already makes on unchecked evidence); `EXC-*` rows live in `ARCHITECTURE.md` → §3
(deployed behaviour that differs from the documented target). A date here is the *when*; the ID is
the *what*, and it is written down once.

---

## Hard dates

| Warning point | Deadline | Work | Detail |
|---|---|---|---|
| **Feb 2027** | **6 Apr 2027** | **2027/28 Pay Calculator rollover.** TWO files, and missing the second is how the selector still stops in March 2027 after the first is done: `paycalc-calc.js` holds `TAX_YEARS` and the tax/NI/student-loan thresholds; **`paycalc-periods.js` holds `ANCHOR_DATE`, `FIRST_OFFSET` and `LAST_OFFSET`**, which are what actually decide how far the period selector runs | KNOWN_LIMITATIONS → Time-boxed maintenance; `.claude/rules/paycalc.md` |
| **Mid-2028** | **End 2028** | **`MAX_YEAR` 2030 → 2032.** Update the lunar / bank-holiday data *first*, then raise the constant | KNOWN_LIMITATIONS → Time-boxed maintenance |
| When the RMT award lands (**VAL-PAY-002 done 26 Aug 2026** — the 28 Aug payslip confirmed £21.49 + London £286.10) | — | **Update `GRADES` / `AWARD_RATES`** with the confirmed rates. Evidence class B required — do not enter a rumoured figure. **AND READ THE `Smart RPS CR Scheme` LINE** — the 2026 award stepped the pension £147.36 → £151.86 on the same payslip, which nothing anticipated: `PENSION_STEPS` was written as "RPS reviews, separate from the pay award" and had no entry, so every payslip after it defaulted low until somebody compared the two. **AND RE-CHECK THE BACK-PAY LUMP against the itemised arrears** — that comparison is what found the accrual 19% high (`awardWindowFactor`, VAL-PAY-001) | `.claude/rules/paycalc.md` · `paycalc-calc.js` (`PENSION_STEPS`) |
| **28 Sep 2026** | **mid-Oct 2026** | **Read the two latency numbers, then settle the plan.** One card visit answers both: (1) "What put the shifts on screen" — the cache/server split that decides Phase 2 (a small server-served share CLOSES it; substantial and slow starts it, narrowest form first), shipped v21.99 so a full month lands ~28 Sep; (2) the **field-confirmation check** gating the identity decision — does `Recognised` track connection quality the way a network wall must? Both reading rules are written in `LATENCY_PLAN.md`; the plan's own close-out says what happens on each answer. **The second one was NOT readable until v22.28** — the card could only split `domReady` by connection, i.e. the milestone the evidence exonerates — so it now has its own block, and because the dimensions have been recorded since v21.30 it reads against August as well as September. **The deadline is soft but real**: samples roll off month by month, and a reading nobody takes is how a plan fades instead of closing | `LATENCY_PLAN.md` · `ROADMAP.md` → the identity round trip |
| **21 Nov 2026** | **Dec 2026** | **ARM the Overtime retention purge** (`VAL-OT-001`, closes `EXC-002`)**.** The job is written and scheduled (`purgeExpiredOvertimeWindows`, daily 04:00 London) but ships DISARMED — it walks each expired window and logs exactly what it would remove, deleting nothing. Read one run of `[purgeExpiredOvertimeWindows]` in the Functions log, confirm the weeks and the counts, then set `purgeArmed: true` in `functions/index.js`. **The dates were RELATIVE until Aug 2026 ("10 weeks after the first Overtime window"), and relative dates are how a deadline gets misread — this one was, in both directions.** They are now computed: the scheduler's first run on 11 Aug 2026 created weeks ending 22 Aug – 12 Sep, and retention is 91 days past the week-ending Saturday, so **the earliest window becomes purgeable on 21 Nov 2026**. Before that the job has nothing to report and the read-a-run gate CANNOT be satisfied — arming early would arm it blind, which is the one thing the disarm exists to prevent. Until it is armed, expired data persists, invisible to the app and contrary to what the retention design says happens to it. Arming is also item 4 of the **Full-launch checklist** in `OVERTIME_AVAILABILITY.md`, which holds everything else the beta's end changes | `OVERTIME_AVAILABILITY.md` → Retention · `VAL-OT-001` |
| **Mar 2027** | **Her return — date not yet known** | **S. Faure's return from maternity leave, and where B. Toth goes.** She came off the rotating dispatcher link on 29 Jun 2026 onto `fixedRoster[2]` (Mon–Fri 09:00–16:00) via a `rosterChanges` entry, and **there is no third entry taking her back** — so she stays on that row indefinitely, and her calendar quietly shows a 09:00–16:00 week she is not working once the absences stop. Two coupled decisions, not one: B. Toth holds line 4 now, so her return needs a line for one of them. The absences are the warning bell — the booking tool caps a range at one year, so whatever was recorded from 29 Jun 2026 runs out by **29 Jun 2027 at the latest** and the roster silently reverts to looking like ordinary work | `roster-data.js` (both entries carry the reasoning) |

**The Overtime purge row is a REVIEW, not a build** (v20.96 wrote the job), and its date is now
FIXED — 21 Nov 2026. This paragraph said the opposite until the v21.40 sweep: that the row "still has
a moving start date" and that the warning point should be diaried "on the first scheduled run after
deploy". That was true while the clock had not started. It has: the daily creator (`0 5 * * *`,
Europe/London) made its first weeks on 11 Aug 2026, which is what let the row above compute the date
instead of describing it. Leaving the old sentence under the new row is precisely the failure that
row warns about — a relative date sitting beside the absolute one that replaced it, and a reader
free to believe either.

The failure of missing the date is not an outage: expired data simply persists, invisible to the app
and contrary to what the retention design says happens to it, which is the kind of gap that is only
ever found by someone asking a data question at the wrong moment.

**The period selector runs out at ≈ P62 (March 2027).** That is the real failure mode of missing the
first row: the calculator does not warn, it simply stops offering periods, and a member planning
their April pay finds the year they need is not there.

---

## Trigger points — watch a number, act before it is reached

| Watch | Act at | Work |
|---|---|---|
| `overrides` document count | Design the archive at **~4,000**; it must land before **~5,000** | Query cost and client cache size both grow with it. A watch item today — no action needed yet, but the design should not start at 4,900 |
| Migration percentage (`passwordStatus`) | **≥90%** | Track C5 — retire the surname default (closes `EXC-005`). Irreversible; also gated on Track E |
| App Speed card, calendar tail | Material drift | The only trigger that reopens the bundler / SDK-deferral question — `ROADMAP.md` → Build tooling |

---

## Recurring reviews

| Cadence | Review | Where |
|---|---|---|
| **Each spring** | Railcard guide claims — every `railcard` row in the source register (`Next` = 2027-05) | `GUIDE_SOURCES.md` |
| **Before 6 April** | Pay thresholds — income tax, NI, student loan, Scottish bands | `GUIDE_SOURCES.md` (`pay-*` rows) |
| **Nov 2026** | FIP ferry rows (`fip-stena`, `fip-attica`) — including the **unresolved** Irish Sea coupon question | `GUIDE_SOURCES.md` |
| **Oct 2026** | `fip-carrier-accept` — high-churn, sampled not certified | `GUIDE_SOURCES.md` |
| **Jan 2027** | The remaining FIP country rows | `GUIDE_SOURCES.md` |
| **Monthly, 1st** | Remove notices posted > 180 days ago | CLAUDE.md → One-time notice pattern |
| **Every 0.10 version** | Re-stamp the five versioned docs | Enforced by `sw-asset-check.test.mjs` |
| **Occasionally, and after any hosting/CSP/API-key change** | Deployment health check on the LIVE URLs in a fresh private window | CLAUDE.md → Deployment health check |

`guide-sources.test.mjs` prints an overdue-row reminder in CI logs — it deliberately never fails on a
date, because a today-driven failure would break unrelated commits. It is a nudge, not a gate.

---

## After every new starter

Not dated, but repeatedly missed, and nothing tells you:

- **Work email.** Since v19.30 nothing prompts for it — the login overlay that used to was retired
  once every existing member was registered. It is a step in `/new-starter` (Operations → Account
  status → Set), and the member can add it in Settings → Work Email, but if both are missed the
  account simply has no email on file **and nothing says so**. The Account status table's Email
  column is the only place it shows.
- **`npm run generate:roster-members`** in the same commit as the roster-data change (CEA/CES/
  Dispatcher only) — without it the new member's shifts are silently excluded from every roster PDF
  import. CI-locked, so this one does fail loudly.
- **Operations → Set up accounts** after deploy, or the account holds no claim.

If joiners ever become frequent enough that the email step is missed repeatedly, the fix is a count
chip on that card — not a return of the modal.
