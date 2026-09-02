# BRASS_PLAN.md — BRASS / AVC top-ups in the Pay Calculator

*The plan for modelling BRASS (the Railways Pension Scheme's Additional Voluntary Contribution
arrangement) in the pay calculator. Three parts: what is ESTABLISHED from public Railpen material,
what the OWNER must find out (each question paired with exactly where its answer lives), and the
integration design — chosen for ease of use first. Not version-stamped; not a runtime asset.*

*Research date: 20 Aug 2026. Nothing below ships until the Part 2 payslip questions are answered —
the whole feature hangs on one fact (NI treatment) that only a real payslip can settle.*

---

## Part 1 — What is established (public Railpen material)

Sources: the Railways Pension Scheme public pages (railwayspensions.co.uk, "Saving more with
BRASS", "Taking my BRASS", "Managing my BRASS", "Saving more with AVC Extra") and the member guide
**PM317 "A guide for members of BRASS", May 2026 edition** — the settling document for every figure
here. These were read via search-engine digests on 20 Aug 2026 because this environment cannot
fetch the pensions sites directly; **confirm each starred figure against the PM317 PDF itself**
(downloadable from the public site or myRPS) before it appears in any staff-facing copy.

**What BRASS is.** The in-scheme AVC facility of the RPS. Contributions build a Personal
Retirement Account (PRA) — a defined-contribution pot held alongside the main defined-benefit
pension, invested by Railpen in member-chosen funds. Historically "British Rail Additional
Superannuation Scheme".

**Paying in:**
- Minimum **£2/week or £10/month**\*; regular deductions through payroll, or one-off lump sums.
- Per-pay-period ceiling: up to **75% of taxable earnings in that period**\*.
- Tax-year maximum (the "BRASS maximum"): the guide gives two formulas — **15% of gross pay minus
  normal RPS contributions**, or **20% of pensionable pay (plus pensionable Restructuring
  Premiums) minus normal contributions**\* — and says the employer's payroll office computes the
  member's actual figure. Which formula applies to the Chiltern section is a Part 2 question.
- Contributions are taken **before tax** (net pay arrangement), so tax relief at the member's
  marginal rate is automatic — nothing to claim.
- Above the BRASS maximum, contributions continue into **AVC Extra** (a second PRA pot, different
  taking rules — out of scope for the calculator; one line of help copy at most).

**Salary sacrifice.** Some employers run BRASS inside a salary-sacrifice (SMART) arrangement: the
member gives up salary, the employer pays the contribution, and the member's **NI drops too**.
Railpen's material notes that sacrifice arrangements typically restrict BRASS changes to an
**annual window** rather than any-time. Whether Chiltern's section does this is THE Part 2
question — it decides the NI wiring in Part 3.

**A legislated change to design for:** from **6 April 2029**, NI relief on salary-sacrificed
pension contributions is capped at **£2,000/year**; contributions above that attract employee and
employer NI like ordinary contributions (Autumn Budget 2025; the NIC (Employer Pension
Contributions) Bill). Consequence for the design: the NI treatment must be **one named constant**,
never scattered assumptions — it will change once in 2029 and possibly differ per member above the
cap. At typical BRASS levels (£50–£150/period ≈ £650–£1,950/year) most members stay under the cap,
which is worth knowing before anyone over-engineers this.

**Taking it (help-copy background only — the calculator never models retirement):** the BRASS pot
must be taken at the same time as the main Scheme pension. Depending on section rules the member
is normally **required** to take a tax-free lump sum of at least the BRASS pot's value, up to
HMRC's maximum (25% of the capital value of the **combined** benefits, bounded by the £268,275
Lump Sum Allowance). Because the DB pension's capital value is large relative to a typical pot,
the 25% headroom usually swallows the whole BRASS fund — money in with full tax relief, out
entirely tax-free. That interaction is the reason BRASS is worth a member's attention, and the
one sentence of "why bother" any help panel should carry. Excess over the allowance is taxed at
marginal rate or converted to pension. Section-specific exceptions exist (Network Rail, TfW,
RSSB, Unisys) — none is Chiltern, but it is why nothing here may be copied into staff-facing text
without the section check in Part 2.

**Matching.** Railpen's material confirms employer matching EXISTS at some employers and warns
that reducing contributions can permanently reduce a match. Whether Chiltern matches anything is a
Part 2 question; if it does, the case for a member joining BRASS strengthens sharply and the help
copy should say so.

---

## Part 2 — What the owner must find out

Ordered by what unblocks what. Question 1 gates the implementation; the rest shape copy and
defaults. Answers belong back in this file, dated, before any code ships.

**Q1 — THE GATE. From one real payslip carrying a BRASS deduction** (your own once contributing,
or a consenting colleague's — the app needs the SHAPE, never their figures):

| Look at | What it decides |
|---|---|
| Is there a separate line naming BRASS (or AVC), and is it the exact £ amount chosen? | The field label the calculator should use, and confirms net-pay (no grossing-up) |
| Is **NI** lower than the calculator predicts for that gross with BRASS ignored? Equivalently: does NI-able pay fall by the BRASS amount? | **The whole design.** Lower NI ⇒ BRASS is inside the sacrifice arrangement ⇒ Wiring A (one-line change). NI unchanged ⇒ Wiring B (tax-only relief). See Part 3 |
| Does the payslip's **Taxable Pay** (YTD) drop by the BRASS paid? | Confirms the Year-to-Date cumulative method needs no change — payslip YTD figures already net BRASS off |

**Q2 — From HR/payroll (one email):**
1. Is BRASS at Chiltern operated through the salary-sacrifice arrangement (same as normal
   contributions)? *(Cross-checks Q1; also determines whether contribution changes are
   annual-window-only, which the help copy must state.)*
2. Does Chiltern match any BRASS contributions for CEA/CES grades? If yes: what rate, up to what?
3. Which BRASS-maximum formula applies to this section (15%-of-gross or 20%-of-pensionable), and
   will payroll confirm a member's personal maximum on request?
4. Are one-off lump sums payable through payroll, and how?

**Q3 — From myRPS (log in once):** download the current **PM317 (May 2026)** BRASS guide and
confirm the starred figures in Part 1; note the Chiltern section's rule on taking BRASS as
tax-free cash (for help copy only); note the default fund/lifestyle arrangement.

**Q4 — Decide the ambition level** (owner decision, after Q1–Q3): calculator-only (Part 3), or
also a short "Saving more with BRASS" section in the Pay Calculator Guide. The guide route pulls
in GUIDE_SOURCES.md discipline — every claim classed and dated — so it is a separate, later piece
of work. Nothing in Part 3 depends on it.

---

## Part 3 — Calculator integration, easiest-to-use first

### The design in one sentence

**One optional field on the Settings card — "BRASS top-up each period (£)" — blank for everyone
who doesn't pay BRASS (the feature is invisible), and for members who do: set once, forget, and
every period's result and breakdown line simply agrees with the payslip.**

### Why that shape and not the alternatives

- **Not a per-period form field** (the pension field's pattern). BRASS is a standing instruction —
  under a sacrifice arrangement it can only change in an annual window — so a per-period field
  would be fifty-two chances to mistype a number that changes once a year, and a new row of UI
  noise for the majority who pay nothing. The pension field is per-period because its DEFAULT
  moves per era (PENSION_STEPS) and members opt out per-period; neither applies to BRASS.
- **Not folded into the existing pension field.** That field carries two load-bearing semantics a
  combined figure would destroy: typed-0 means "salary-sacrifice opt-out", and
  saved-value-equal-to-default self-heals to null (v18.43) so era changes propagate. A member
  entering pension+BRASS combined would fight the self-heal on every era step and lose the
  opt-out signal. The four historic money defects in paycalc-form-data.js's header all came from
  overloading that field's meaning — this would be a fifth.
- **Member-level storage under `pcPrefix()`** (a new `SK.brass` in paycalc-migrations.js): per
  member on shared devices, swept into the backup/restore file by `selectBackupKeys` with zero
  transfer-card changes, and covered by the existing key-parity guard shape.

### The maths — two wirings, Q1 picks one

Current model (calibrated against MILLER_ACTUALS): `sacGross = gross − pension`, and tax, NI and
student loan are ALL computed on `sacGross`.

- **Wiring A — BRASS inside the sacrifice (expected):** `sacGross = gross − pension − brass`.
  One subtraction; tax, NI and SL all fall. Cumulative PAYE needs nothing: payslip YTD Taxable
  Pay already nets BRASS off (Q1 check 3), so the YTD method stays consistent automatically.
- **Wiring B — net pay but NOT sacrifice:** tax is computed on `sacGross − brass`; NI and SL stay
  on `sacGross`. Slightly wider diff (computeTax gains nothing — its caller passes a different
  first argument — but the breakdown must label the two bases honestly).

Either way the treatment lives behind **one named constant** (`BRASS_SACRIFICE = true/false`) in
paycalc-calc.js with the Q1 payslip cited beside it — both because Q1 decides it and because the
April 2029 £2,000 NI cap will revisit it. Do not scatter the assumption.

### What the member sees

1. **Settings card**, under Pension: `BRASS top-up each period (£)` with a `?` (HELP_CONTENT
   entry: two sentences on what BRASS is, the tax-free-cash sentence, "leave blank if you don't
   pay BRASS", and — if Q2.1 says sacrifice — "changes only in the annual window").
2. **Result breakdown**: a `BRASS top-up −£X` row (paycalc-breakdown.js, pure, tested), rendered
   only when brass > 0 — so "Check against your payslip" works line-for-line.
3. **Year to Date summary**: `computeYearSoFar` re-runs saved periods with the SAME member-level
   brass. Known approximation: a member who changes their BRASS amount mid-year gets historic
   periods re-priced at the new figure. Accepted for phase 1 (changes are annual-window rare) and
   stated in the help copy; **the upgrade trigger is a member reporting a wrong historic period
   after a window change** — then, and only then, add a per-period override on the pension
   field's exact pattern.
4. **Everything else unchanged**: HPP (BRASS is not variable pay), back-pay (arrears are gross;
   BRASS doesn't touch them), roster pre-fill, sticky total (net already reflects it).

### File-by-file change map (phase 1)

| File | Change |
|---|---|
| `paycalc-migrations.js` | `SK.brass` key (namespaced) |
| `paycalc.html` | one labelled input + `?` on the Settings card |
| `paycalc-settings.js` | load/save `SK.brass` (same shape as the pension setting) |
| `paycalc-calc.js` | `BRASS_SACRIFICE` constant + the one-line base change per Q1 |
| `paycalc-app.js` | read the setting in `calculate()`, pass to breakdown + year summary |
| `paycalc-breakdown.js` | the conditional row |
| `paycalc-year-summary.js` | accept `brass` in the per-payslip re-run |
| `paycalc-help.js` | HELP_CONTENT entry |
| Tests | `paycalc.test.mjs` (both wirings' arithmetic, the chosen one against the Q1 payslip's real figures); `paycalc-breakdown.test.mjs` (row present iff brass > 0); key-parity + help-shape guards pick the rest up |
| Docs | `.claude/rules/paycalc.md` one row; a `VALIDATION_REGISTER.md` entry **only if** shipped before Q1 is fully settled (it should not be) |

No new modules, so no CLAUDE.md/AI_MAP module obligations; ~1 version bump; no Firestore, rules,
SW or notification surface at all — this is the rare feature that is purely local maths.

### Out of scope, recorded so nobody wonders

One-off lump-sum contributions (rare; visible on the payslip they hit; revisit only on demand);
AVC Extra (above-maximum contributions — one help-copy sentence, no maths); retirement modelling
(the calculator estimates pay periods, not pensions); the 2029 NI cap (a one-constant change when
it arrives — add a MAINTENANCE_CALENDAR row for early 2029 when the feature ships).
