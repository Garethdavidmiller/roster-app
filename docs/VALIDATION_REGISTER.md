# VALIDATION_REGISTER.md — claims the app makes that have not been checked

*Not version-stamped; not a runtime asset.*

**This is not a to-do list and it is not a roadmap.** Every row is something the app already tells
staff, computed from an assumption nobody has yet checked against reality. The work is not building
anything — it is *looking at one document* and either confirming a number or correcting it.

It exists because that kind of debt has nowhere obvious to live, so it ends up filed as a feature.
The back-pay row (now closed, below) spent months in `ROADMAP.md` under **NEXT**, reading like
something to build — when it was a five-minute check against a payslip that was already in a drawer.

**This is the authoritative register of unverified claims. Cite a row by its ID — `VAL-PAY-001` —
rather than re-explaining the uncertainty somewhere else.** A restated uncertainty is one that can be
closed in one file and left open in another, which is the failure this file was created to end.

**The registers, and the difference between them:**

| | Question it answers |
|---|---|
| `MAINTENANCE_CALENDAR.md` | What must happen **by a date**, whether or not anyone plans it |
| `VALIDATION_REGISTER.md` (this file) | What the app **already asserts** on evidence nobody has verified |
| `ARCHITECTURE.md` → §3 | Where **deployed** differs from **documented target** (`EXC-*`) |
| `ROADMAP.md` | What we might **build** |

**A `VAL` row is not an `EXC` row.** An `EXC` is a gap everyone can see between what is deployed and
what is intended — the risk is a reader believing the intended state is already live. A `VAL` is a
state everyone believes is *correct*; the risk is that it is quietly wrong and nothing will ever say
so. The two are kept in separate ID spaces for that reason. Some rows relate: `VAL-OT-001` is the
evidence behind the Overtime purge, and says so.

`GUIDE_SOURCES.md` is the same idea applied to the guides, and it is far more developed — every
high-risk claim there carries its source, its review dates and an evidence class, structurally
enforced by `guide-sources.test.mjs`. **Guide claims are not repeated here**; the two guide rows below
point at it. What this file adds is the same discipline for the claims the *app* makes.

---

## How to read a row

**Cost if wrong** is the column that decides the order. A wrong figure that a member can see and
correct is a nuisance; a wrong figure that looks right is what actually causes harm, because it is
believed. Rows are ordered by that, not by effort.

**Settled by** names the single artefact that would close it. If a row does not have one, it is not a
validation item — it is research, and it belongs in `ROADMAP.md`.

**The ID is stable and is never reused.** A closed row keeps its ID and moves to *Closed* at the
bottom; a new row takes the next number in its family, never a gap left by a closure. Families are
`PAY` · `OT` · `GUIDE` · `AUTH` · `AL`. `doc-parity.test.mjs` fails if any document cites an ID that does
not exist here, or if an ID is declared twice.

---

## Money

| ID | Claim | Settled by | Cost if wrong | Where it lives |
|---|---|---|---|---|
| **VAL-PAY-003** | **Pension £156.29 from the 1 Aug 2025 payslip.** The only step in `PENSION_STEPS` that was **derived from PAYSLIP_ACTUALS totals** rather than read off a payslip line. Every other step in the table is payslip-confirmed. | The `Smart RPS CR Scheme` line on the **1 Aug 2025 payslip** | Small and bounded — one period's default, self-healing on any period the member has touched. Listed because a derived figure sitting in a table of confirmed ones is indistinguishable from them | `paycalc-calc.js` (`PENSION_STEPS`) |
| **VAL-PAY-004** | **CES has no 2025/26 `pre` rate on record.** Deliberately absent rather than guessed, so the box stays editable and compute-mode can be finished by hand. | Any **CES payslip from before 24 Oct 2025** | None today — the app declines to state it, which is the correct behaviour: the back-pay box stays blank, and the main calculator labels those periods "post-rise rate" with a note that the earlier rate is not on record. It is here so the blank is not later "fixed" with an inferred number | `paycalc-calc.js` (`AWARD_RATES`) |
| **VAL-PAY-005** | **A payslip across a change of grade is paid by its days.** 7 days as a CEA and 21 as a CES is priced at £22.3225 an hour — 140 contracted hours £3,125.15, exactly 35 at £21.49 and 105 at £22.60. An owner decision on the natural reading (13 Nov 2026), not a payslip. Premium hours on that payslip are priced the same way, an estimate: nothing records which side of the change a Saturday fell on. | The **18 Dec 2026 payslip** of the member whose grade changes on 22 Nov 2026 — its basic-pay lines | One payslip per promotion, and visible: the line under its rate says how it was priced. If payroll pays the whole payslip at one grade, the estimate is out by the difference between the rates on the days the other side of the change | `paycalc-grade.js` (`byDays`) · `paycalc-settings.js` (`periodRate`) |

---

## Operational claims

| ID | Claim | Settled by | Cost if wrong | Where it lives |
|---|---|---|---|---|
| **VAL-OT-001** | **The Overtime retention purge removes the right windows.** The job is written, scheduled, and **arms itself on 1 Dec 2026** — until then it walks each expired window and logs what it would delete. Nothing has ever been deleted, so the plan is asserted and untested. Overtime is paused, and the purge still runs (`OVERTIME_AVAILABILITY.md` → Paused). | **Reading one logged run between 21 Nov and 1 Dec 2026** — the ten-day gap exists to produce exactly this evidence, since nothing expires before 21 Nov and no earlier run has a real window to describe. Optional rather than a gate now: it is how you CONFIRM the walk, not what permits it | A bottom-up delete against live data with no cascade, and the failure is unrecoverable — which is why the date sits after the first expiry rather than on it | `functions/overtime-core.js` (`purgeArmedAt`) · `functions/overtime.js` · dated in `MAINTENANCE_CALENDAR.md` |
| **VAL-GUIDE-001** | **Two Rangers & Rovers claims where the publisher contradicts itself.** Not a gap in our reading — re-reading cannot settle either. Marked per-claim on the page. | **Chiltern retail guidance**, not National Rail | A staff member accepts or refuses a ticket at the gateline on our word | `GUIDE_SOURCES.md` (`rr-*` rows) — **not restated here** |
| **VAL-GUIDE-002** | **The FIP Kosovo caveat** — RSTL cannot verify whether Srbija Voz FIP facilities are still available at Elez Han — carried unresolved rather than decided either way. | RST or the operator, at the **Mar 2027** review (`fip-kosovo`; re-read at source 10 Nov 2026, still unverifiable) | A member is turned away abroad holding a document we said would work | `GUIDE_SOURCES.md` (`fip-*` rows) — **not restated here** |

---

## Design claims with no numbers behind them

| ID | Claim | Settled by | Cost if wrong | Where it lives |
|---|---|---|---|---|
| **VAL-AUTH-001** | **Track E's decision gate.** The design is sound and the measurement that would decide it has never been taken — `AUTH_PLAN.md` says so in its own confidence table, which is the right thing for a plan to admit. | The **§6 measurement** described in that plan | The decision gets taken on intuition, and it is the one that determines whether the whole app moves behind authentication | `AUTH_PLAN.md` → E3 |

---

## Closed

Kept, briefly, because a closed row is the evidence that this file is used rather than merely
written — and because three of these were closed by *disproving* the assumption.

| ID | Claim | Outcome |
|---|---|---|
| **VAL-GUIDE-002** (Irish Sea half) | The FIP Irish Sea coupon question | **Resolved at source** — nil coupons, FIP Card 50% only, on the active-staff carrier table (`fip-stena-irish-sea`). The Kosovo half stays open above |
| **VAL-AUTH-006** | The Calendar's start wall is one `accounts:lookup` round trip — measured on an emulator with injected latency, with the FIELD contribution inferred rather than observed | **Confirmed on live staff devices**, 12 Sep 2026, on the signature the plan nominated in advance: `Recognised` runs 48% / 68% / 91% over a second across the not-reported / 4G-like / 3G-like groups while `Getting ready` is **0% over half a second in every one of them**. A network wall moves with the network and a parse wall does not, and the flat Getting-ready row also disposes of the platform-mix confound. `LATENCY.md` → *THE FULL-MONTH READ*. The fast path built against it was then measured to fire on **1 open of ~800 eligible** (19 Sep 2026), which explains why it did not move the aggregate and leaves this confirmation unqualified; it was retired on 26 Sep 2026. `LATENCY.md` → *THE CLOSING READ* |
| **VAL-AUTH-002** | The offline design (E4) rests on an unvalidated assumption — that the local cache serves reads the rules would deny | **Confirmed**, by the same run that disproved VAL-AUTH-004 below: they are one mechanism seen from its two ends, availability and security. `experiments/firestore-offline-proof/` names both in its own README. Closed 28 Aug 2026 |
| **VAL-AUTH-003** | The Calendar viewer dies with the browser session | **Disproved**, then fixed. `setPersistence` migrated the restored viewer into IndexedDB on any reload, so it survived the browser closing — no PIN for the next person at a shared PC. Proven both ways in a real Chromium: `experiments/viewer-persistence-proof/` (`CALENDAR_DATA.md` 12) |
| **VAL-AUTH-004** | The local Firestore cache respects the security rules | **Disproved.** It does not — rules are server-side, and a cache hit never consults one. This is why the Calendar refuses the read at source rather than relying on the rules: `experiments/firestore-offline-proof/` |
| **VAL-AUTH-005** | A correct PIN mints a viewer token | **Confirmed in production**, after an earlier release shipped on a dark-deploy sign-off that had never once exercised the minting path and had to be rolled back. The cause was an IAM grant living in GCP, invisible to every test (`RECOVERY_RUNBOOK.md` → "The Calendar PIN") |
| **VAL-PAY-001** | The back-pay accrual reproduces the real lump | **Disproved, then fixed** (26 Aug 2026, the 28 Aug payslip). The estimate was 19% high, exactly the failure the row predicted: "if Chiltern pro-rates from literal 1 April, P4 overstates". A period is 28 days of SHIFTS paid six days after its cut-off, so the first period of the year covers work done largely in MARCH, and the accrual counted it whole. `awardWindowFactor` scales it to the days on/after 1 April, and the London Allowance — a flat uplift with no hours in it — settles it to the penny. **Verified on the CARD, 27 Aug 2026** (owner) as well as in the rule: a corrected rule and a corrected screen are two different claims, and only the second is what a member reads. Figures: `.claude/rules/paycalc.md` → "THE FIRST PERIOD IS A FRACTION" |
| **VAL-PAY-002** | The 2026/27 award steps on the 28 Aug 2026 payslip — rate and London together | **Confirmed** (26 Aug 2026). The rate, both premiums and the London Allowance all stepped on that payslip, read line by line — its lines sum to its stated total, so the reading is exact rather than inferred. **It also moved something nobody had modelled:** the pension stepped on the same payslip, because the contribution is a proportion of pensionable pay, and `PENSION_STEPS` had no entry for it — see the ⚠️ note in `paycalc-calc.js` and the MAINTENANCE_CALENDAR row. Figures: `.claude/rules/paycalc.md` → Current rates |
| **VAL-AL-001** | AL recorded over a voluntary RDW consumes zero entitlement | **Confirmed by the owner, 26 Aug 2026** — and the operational answer is narrower than the question. Annual leave reaches a rest day *only* when a member has **swapped working days and then books the swapped-in day off**; agreeing RDW and later booking it as AL is not a thing that happens. That is exactly the case `isContractedWorkOverride` already charges for (`shift`), so the shipped shape is right on both halves: the swap costs a day, and the voluntary-RDW branch guards a path the roster office does not use. The "should it display AL at all?" worry in the original row is moot — the display it described does not arise. **Extended 10 Nov 2026 (owner): "Free, like plain RDW."** Leave over a base rest day holding an Other day ("TRG RDW") or a Spare turn costs nothing either; only a recorded swap (`shift`) does. `isContractedWorkOverride(ov, baseShift)` answers it |
