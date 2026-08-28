# VALIDATION_REGISTER.md — claims the app makes that have not been checked

*Created August 2026 (at v21.28), external review. Not version-stamped; not a runtime asset.*

**This is not a to-do list and it is not a roadmap.** Every row is something the app already tells
staff, computed from an assumption nobody has yet checked against reality. The work is not building
anything — it is *looking at one document* and either confirming a number or correcting it.

It exists because that kind of debt has nowhere obvious to live, so it ends up filed as a feature.
The back-pay row below spent months in `ROADMAP.md` under **NEXT**, between a bulk pre-fill feature
and Dispatcher rate support, reading like something to build — when it is a five-minute check against
a payslip that is already in a drawer.

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
evidence that would let `EXC-002` close, and says so.

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
| **VAL-PAY-003** | **Pension £156.29 from the 1 Aug 2025 payslip.** The only step in `PENSION_STEPS` that was **derived from MILLER_ACTUALS totals** rather than read off a payslip line. The four others in the table are payslip-confirmed. | The `Smart RPS CR Scheme` line on the **1 Aug 2025 payslip** | Small and bounded — one period's default, self-healing on any period the member has touched. Listed because a derived figure sitting in a table of confirmed ones is indistinguishable from them | `paycalc-calc.js` (`PENSION_STEPS`) |
| **VAL-PAY-004** | **CES has no 2025/26 `pre` rate on record.** Deliberately absent rather than guessed, so the box stays editable and compute-mode can be finished by hand. | Any **CES payslip from before 24 Oct 2025** | None today — the app declines to state it, which is the correct behaviour. It is here so the blank is not later "fixed" with an inferred number | `paycalc-calc.js` (`AWARD_RATES`) |

---

## Operational claims

| ID | Claim | Settled by | Cost if wrong | Where it lives |
|---|---|---|---|---|
| **VAL-OT-001** | **The Overtime retention purge removes the right windows.** The job is written, scheduled and **ships disarmed** — it walks each expired window and logs what it would delete. Nothing has ever been deleted, so the plan is asserted and untested. | **Reading one logged run** after 21 Nov 2026, when the first window becomes purgeable. The gate cannot be satisfied before then | Arming it blind is a bottom-up delete against live data with no cascade — the failure is unrecoverable, which is precisely why the disarm exists | `functions/overtime.js` · deadline in `MAINTENANCE_CALENDAR.md` · closes `EXC-002` |
| **VAL-GUIDE-001** | **Two Rangers & Rovers claims where the publisher contradicts itself.** Not a gap in our reading — re-reading cannot settle either. Marked per-claim on the page. | **Chiltern retail guidance**, not National Rail | A staff member accepts or refuses a ticket at the gateline on our word | `GUIDE_SOURCES.md` (`rr-*` rows) — **not restated here** |
| **VAL-GUIDE-002** | **The FIP Irish Sea coupon question, and the Kosovo caveat** carried unresolved rather than decided either way. | The relevant operator, at the **Nov 2026** review | A member is turned away abroad holding a document we said would work | `GUIDE_SOURCES.md` (`fip-*` rows) — **not restated here** |

---

## Design claims with no numbers behind them

| ID | Claim | Settled by | Cost if wrong | Where it lives |
|---|---|---|---|---|
| **VAL-AUTH-001** | **Track E's decision gate.** The design is sound and the measurement that would decide it has never been taken — `AUTH_PLAN.md` says so in its own confidence table, which is the right thing for a plan to admit. | The **§6 measurement** described in that plan | The decision gets taken on intuition, and it is the one that determines whether the whole app moves behind authentication | `AUTH_PLAN.md` → E3 |

---

## Closed

Kept, briefly, because a closed row is the evidence that this file is used rather than merely
written — and because two of these were closed by *disproving* the assumption.

| ID | Claim | Outcome |
|---|---|---|
| **VAL-AUTH-002** | The offline design (E4) rests on an unvalidated assumption — that the local cache serves reads the rules would deny | **Confirmed**, by the same run that disproved VAL-AUTH-004 below: they are one mechanism seen from its two ends, availability and security. `experiments/firestore-offline-proof/` names both in its own README. Closed 28 Aug 2026 on reading it — the row had gone on saying the experiment "measured the neighbouring question", which is what it was written before the run |
| **VAL-AUTH-003** | The Calendar viewer dies with the browser session | **Disproved**, then fixed. `setPersistence` migrated the restored viewer into IndexedDB on any reload, so it survived the browser closing — no PIN for the next person at a shared PC. Proven both ways in a real Chromium: `experiments/viewer-persistence-proof/` (v21.21) |
| **VAL-AUTH-004** | The local Firestore cache respects the security rules | **Disproved.** It does not — rules are server-side, and a cache hit never consults one. This is why the Calendar refuses the read at source rather than relying on the rules: `experiments/firestore-offline-proof/` |
| **VAL-AUTH-005** | A correct PIN mints a viewer token | **Confirmed in production** (v20.51 step 2b), after v20.46 shipped on a dark-deploy sign-off that had never once exercised the minting path (and v20.50 rolled it back). The cause was an IAM grant living in GCP, invisible to every test |
| **VAL-PAY-001** | The back-pay accrual reproduces the real lump | **Disproved, then fixed** (26 Aug 2026, the 28 Aug payslip). The app estimated **£977.69** against **£821.68** paid — 19% high, exactly the failure the row predicted: "if Chiltern pro-rates from literal 1 April, P4 overstates". A period is 28 days of SHIFTS paid six days after its cut-off, so the first period of the year covers work done largely in MARCH, and the accrual counted it whole. `awardWindowFactor` (v21.79) scales it to the days on/after 1 April. The **London Allowance settles it to the penny** — a flat per-period uplift with no hours in it, so it isolates the window: 4/28 + 4 whole periods × £9.94 = £41.18, and the arrears inside that payslip's London line are £41.18. **Verified on the CARD, 27 Aug 2026** (owner): the fixed app now shows the figure the payslip paid. Worth recording as its own step rather than folding into the fix — the whole lesson of the same week was that a corrected rule and a corrected screen are two different claims, and only the second is what a member reads |
| **VAL-PAY-002** | The 2026/27 award steps on the 28 Aug 2026 payslip — rate and London together | **Confirmed** (26 Aug 2026). `Basic Pay 116.17 @ 21.49`; premiums at £26.86 (1.25×) and £32.23 (1.5×); London on the same payslip. The payslip's 50 lines sum to its stated £6,180.64, so the reading is exact rather than inferred. **It also moved something nobody had modelled:** the pension stepped £147.36 → **£151.86** on the same payslip, because the contribution is a proportion of pensionable pay. `PENSION_STEPS` was written as "RPS reviews, SEPARATE from the pay award" and had no entry for it — see the ⚠️ note now in `paycalc-calc.js` and the MAINTENANCE_CALENDAR row |
| **VAL-AL-001** | AL recorded over a voluntary RDW consumes zero entitlement | **Confirmed by the owner, 26 Aug 2026** — and the operational answer is narrower than the question. Annual leave reaches a rest day *only* when a member has **swapped working days and then books the swapped-in day off**; agreeing RDW and later booking it as AL is not a thing that happens. That is exactly the case `isContractedWorkOverride` already charges for (`shift`), so the shipped v21.55 shape is right on both halves: the swap costs a day, and the voluntary-RDW branch guards a path the roster office does not use. The "should it display AL at all?" worry in the original row is moot — the display it described does not arise |
