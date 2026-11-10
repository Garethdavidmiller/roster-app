# MAINTENANCE_CALENDAR.md — dated obligations

*Not version-stamped; not a runtime asset.*

**This is the work that has a deadline whether or not anyone plans it.** It belongs here rather than
in KNOWN_LIMITATIONS.md prose or GUIDE_SOURCES.md rows: those files are read when investigating
something, and a tax-year rollover is not something you investigate — it either happened in time or
it did not.

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
| — nothing to diary | **1 Dec 2026** | **The Overtime retention purge arms itself** — it reports what it would delete until then, and deletes from then on (`purgeArmedAt` in `functions/overtime-core.js`, which holds the reasoning for the date). It keeps running while Overtime is paused. Reading its log (`[purgeExpiredOvertimeWindows]`) is OPTIONAL confirmation (`VAL-OT-001`), not a gate | `OVERTIME_AVAILABILITY.md` → Retention · `VAL-OT-001` |
| **Sat 5 Dec 2026** — confirm both are deployed | **Sat 12 Dec 2026, 18:00** | **The one-off timetable push fires** (`sendTimetableReminder`, functions/documents.js — a daily 18:00 London schedule guarded to this one evening) and **the final-week Calendar notice runs 6–12 Dec** (`timetable-soon-2026`, calendar-notices.js). Afterwards read the function's log for "Timetable reminder sent"; both retire themselves. The function then runs harmlessly every evening until the constant moves to the next change — move it, or delete the function, with the May 2027 books | `.claude/rules/notifications.md`; CLAUDE.md → notices table; OPERATIONS_REFERENCE → The one-off timetable push |
| **Sun 13 Dec 2026** — the change itself | **13 Dec 2026** | **The Trains page turns over by itself** — the first column becomes "Until 12 Dec" and a looked-up time answers from December's timetable. Open it live that morning to see it did, and run `npm run test:live` | OPERATIONS_REFERENCE → The Trains page's timetables |
| **Mid-Jan 2027** | **Late Jan 2027** | **Chiltern's festive changes end on 10 January**, and the page's Christmas note retires itself on the 11th. Check Chiltern's timetable page for re-issued books (corrections after the change) and regenerate if there are any. From the 11th the Trains page opens on Stations rather than What changed, on the station the device looked at last, and its caveat stops warning about Christmas | `docs/timetable-dec26/tooling/README.md` |
| **Feb 2027** | **6 Apr 2027** | **2027/28 Pay Calculator rollover.** TWO files, and missing the second is how the selector still stops in March 2027 after the first is done: `paycalc-calc.js` holds `TAX_YEARS` and the tax/NI/student-loan thresholds; **`paycalc-periods.js` holds `ANCHOR_DATE`, `FIRST_OFFSET` and `LAST_OFFSET`**, which are what actually decide how far the period selector runs. **The selector runs out at ≈ P62 (the 12 Mar 2027 payslip)** — the calculator does not warn, it simply stops offering periods, and a member planning their April pay finds the year they need is not there | KNOWN_LIMITATIONS → Time-boxed maintenance; `.claude/rules/paycalc.md` |
| **Mar 2027** | **26 Mar 2027** (Good Friday) | **Bank holidays are not on the Trains page.** Good Friday, Easter Monday (29 Mar) and the early-May holiday (3 May) run special timetables, and the page shows the normal pattern for the kind of day. Decide whether it should say so — an open question in ROADMAP → "Trains page" | ROADMAP.md → Trains page — what comes after the preview |
| **Mar 2027** | **Her return — date not yet known** | **S. Faure's return to the rotating link, and where B. Toth goes.** She came off the rotating dispatcher link on 29 Jun 2026 onto `fixedRoster[2]` (Mon–Fri 09:00–16:00) via a `rosterChanges` entry, and **there is no entry taking her back** — so she stays on that row indefinitely, and her calendar quietly shows a 09:00–16:00 week she is not working once the absences stop. Two coupled decisions, not one: B. Toth holds line 4 now, so her return needs a line for one of them. The absences are the warning bell — the booking tool caps a range at one year, so whatever was recorded from 29 Jun 2026 runs out by **29 Jun 2027 at the latest** and the roster silently reverts to looking like ordinary work | `roster-member-data.js`, re-exported by `roster-data.js` (both entries carry the reasoning) |
| **Apr 2027** — look for Chiltern's May books | **16 May 2027** | **The Trains page's timetables run out.** Its December side is Chiltern's books valid from 13 December 2026 to Saturday 15 May 2027 (Sundays to 9 May), so from the next change it compares two timetables neither of which is running. Download the new books, re-run `docs/timetable-dec26/tooling/`, and move `CHANGE_DATE`, `FURTHER_CHANGES_UNTIL`, `DEC_VALID_UNTIL`, `LEAF_FALL` and `SOURCES` in `build.py` — every date the page shows is derived from them, so nothing else is typed. If nobody does, the page says from 16 May that both its timetables have ended (`DEC_VALID_UNTIL`) rather than showing old times as current. The December books were online by 20 Oct 2026, eight weeks before their start | `docs/timetable-dec26/tooling/README.md`; OPERATIONS_REFERENCE → The Trains page's timetables |
| **Jan 2028** | **30 Apr 2028** | **Node.js 24 reaches end of life** (Google retires the `nodejs24` Cloud Functions runtime on 31 Oct 2028). Every CI job pins `node-version: '24'`, and the Cloud Functions run on it (`functions/package.json` `engines`). Do the same with the next LTS: check Firebase offers it for Cloud Functions, then move the runtime and every job together. The PR job runs the Functions suites on the deployed runtime on purpose (CLAUDE.md → `test:functions`), so the two must not drift apart | `.github/workflows/`; `functions/package.json` |
| **Mid-2028** | **End 2028** | **`MAX_YEAR` 2030 → 2032.** Update the lunar / bank-holiday data *first*, then raise the constant, **then run `npm run generate:roster-members` in the same commit** — the Overtime functions read the horizon from `functions/roster-members.json`, and a server left on 2030 stops creating windows from the first week of 2031 (`sw-asset-check.test.mjs` fails until it is regenerated) | KNOWN_LIMITATIONS → Time-boxed maintenance |
| When the next RMT award lands | — | **Update `GRADES` / `AWARD_RATES`** with the confirmed rates. Evidence class B required — do not enter a rumoured figure. **AND READ THE `Smart RPS CR Scheme` LINES** on the award payslip AND the one before it: a pay award moves the pension too, and `PENSION_STEPS` needs a step from that payslip or every later payslip defaults low. The step can begin inside the earlier payslip, printed as two lines — the 2026/27 rise did (31 Jul 2026: £113.90 + £36.84), and that payslip carries their total. **AND RE-CHECK THE BACK-PAY LUMP against the itemised arrears** — that comparison is what found the accrual 19% high (`awardWindowFactor`, VAL-PAY-001) | `.claude/rules/paycalc.md` · `paycalc-calc.js` (`PENSION_STEPS`) |

---

## Trigger points — watch a number, act before it is reached

| Watch | Act at | Work |
|---|---|---|
| `overrides` document count | Design the archive at **~4,000**; it must land before **~5,000** | Query cost and client cache size both grow with it. A watch item today — no action needed yet, but the design should not start at 4,900 |
| Migration percentage (`passwordStatus`) | **≥90%** | Track C5 — retire the surname default (closes `EXC-005`). Irreversible; also gated on Track E, unless the owner adopts the second route (`CREDENTIAL_LIFECYCLE.md` §7, not adopted) |
| App Speed card, calendar tail | Material drift | A measured input, deliberately **not** a trigger for a build step — `DECISIONS.md` → "No build step" says what would reopen that, and `LATENCY.md` → Phase 3 holds the reading that would justify acting |

---

## Recurring reviews

| Cadence | Review | Where |
|---|---|---|
| **Nov 2026** | **Railcard:** the ten `rc-*` rows (Marylebone off-peak and restrictions, forgotten Railcard, 16-17 Saver and seasons, Network easements, digital display, Jobcentre Plus and its validity, London discounts) | `GUIDE_SOURCES.md` |
| **Nov 2026** | **Rangers & Rovers:** the eight `rr-*` rows (Shakespeare Explorer and its break of journey, the Thames Rover operator question, Cotswolds, Severn & Solent, Two Together, the date box, advance sale) | `GUIDE_SOURCES.md` |
| **Nov 2026** | **FIP money and booking:** `fip-booking-table`, `fip-sncf-payment`, the five supplement rows (`fip-at`/`-es`/`-pl`/`-sk-supplements`, `fip-cz-supplement`), and the ferry rows `fip-stena-north-sea`, `fip-stena-irish-sea`, `fip-attica` | `GUIDE_SOURCES.md` |
| **Dec 2026** | **FIP countries:** every per-country row (`fip-fr` … `fip-ni`, including `fip-ch-mountain`, `fip-hu-gysev`, `fip-lake-constance`) plus `fip-carrier-accept` and `fip-kosovo` — the Kosovo caveat is the one open question (`VAL-GUIDE-002`) | `GUIDE_SOURCES.md` |
| **Jan 2027** | **FIP booking and fares:** `fip-contact`, `fip-booking-channel`, `fip-sncf-fare-codes`, `fip-quota`, `fip-child-fares` and `fip-eurostar-fares` (the Eurostar Blue FIP Card fares) | `GUIDE_SOURCES.md` |
| **Feb 2027** | The FIP rules rows (`fip-eurostar-rules` among them) and most of the remaining Railcard and Rangers rows | `GUIDE_SOURCES.md` |
| **May 2027** | Eight Railcard rows (`rc-forces`, `rc-ff-peak`, `rc-ff-under5`, `rc-senior-peak`, `rc-twotogether`, `rc-gold`, `rc-groupsave`, `rc-minfare`); **Aug 2027** `rc-1617-2026-change` | `GUIDE_SOURCES.md` |
| **Before 6 April** | Pay thresholds — income tax, NI, student loan, Scottish bands (Mar 2027), and the pay rates (Apr 2027) | `GUIDE_SOURCES.md` (`pay-*` rows) |
| **Monthly, 1st** | Remove notices posted > 180 days ago | CLAUDE.md → One-time notice pattern |
| **Every 0.10 version** | Re-stamp the versioned docs (the list is `DOC_STAMPS` in `sw-asset-check.test.mjs`) | Enforced by `sw-asset-check.test.mjs` and `githooks/pre-commit` |
| **Occasionally, and after any hosting/CSP/API-key change** | Deployment health check on the LIVE URLs in a fresh private window | CLAUDE.md → Deployment health check |
| **Quarterly** (next Feb 2027) | **The dependencies the update bot does not raise**, each for the reason `.github/dependabot.yml` gives: the Cloud Functions' (`npm outdated --prefix functions`, and `npm audit --omit=dev --prefix functions`; any change there needs an app version bump), the Firebase web SDK (`firebase-client.js`, with `FIREBASE_SDK_VERSION` in `service-worker.js` and the root `firebase` package the rules tests use — `dependency-pin-parity.test.mjs` holds the copies together), the vendored DOMPurify (the `npm pack` recipe in `generate-sri.mjs`'s header), the Mammoth CDN copy (`generate-sri.mjs --apply`, pinned alike on both sides), `pdfjs-dist` (both manifests, exactly) and Playwright (it moves with the dev container's pre-installed browsers) | `.github/dependabot.yml`; KNOWN_LIMITATIONS → Development-tool advisories |

The guide rows above are copied from the register's `Next` column (7 Nov 2026); where they differ,
the register wins — re-derive them from it rather than editing a date here.
`guide-sources.test.mjs` prints an overdue-row reminder in CI logs — it deliberately never fails on a
date, because a today-driven failure would break unrelated commits. It is a nudge, not a gate.

---

## After every new starter

Not dated, but repeatedly missed, and nothing tells you:

- **Work email.** Nothing prompts for it. It is a step in `/new-starter` (Operations → Account
  status → Set email), and the member can add it in Settings → Work Email, but if both are missed the
  account simply has no email on file **and nothing says so**. The Account status card's
  "No work email" line is the only place it shows.
- **`npm run generate:roster-members`** in the same commit as the roster-data change (every grade,
  Management included — the same file holds the login list and the role lists) — without it a new
  CEA, CES or Dispatcher's shifts are silently excluded from every roster PDF import, and a new
  manager gets no login. CI-locked, so this one does fail loudly.
- **Operations → Set up accounts** after deploy, or the account holds no claim.

If joiners ever become frequent enough that the email step is missed repeatedly, the fix is a count
chip on that card — not a return of the modal.
