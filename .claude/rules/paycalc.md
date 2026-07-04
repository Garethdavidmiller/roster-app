---
paths:
  - "paycalc.html"
  - "paycalc-*.js"
  - "paycalc.css"
  - "paycalc.test.mjs"
  - "paycalc-*.test.mjs"
---

# Pay calculator — full reference

## Current rates (v8.21+)

Primarily **manual-entry**. Staff enter hours; calculator computes tax, NI, pension, take-home.

**Grades supported:** CEA and CES. Dispatcher not yet supported — rates not confirmed.

| Grade | 2025/26 rate | Contracted hrs | Pension | London Allowance |
|-------|-------------|----------------|---------|-----------------|
| CEA | £20.74/hr | 140/period | £147.36 (from P51 May 8 2026) | £276.16 |
| CES | £21.81/hr | 140/period | £147.36 (from P51 May 8 2026) | £276.16 |

2026/27 rates: not yet confirmed — update `GRADES` in `paycalc-calc.js` when announced.

**Members with `startDate`:** for the joining period, `calcProRateFactor` scales contracted hours, London Allowance, pension default, and HPP. All subsequent periods use standard amounts automatically.

`saveSettings` guards the pension default on joining periods — writes `getPensionDefault(curP)` (full rate), not the field value (pro-rated). Without this guard, saving Settings on the joining period corrupts the default for subsequent periods.

The **roster-assist hint bar** pre-fills Sat/Sun/BH/Boxing Day/RDW hours from base roster + Firestore overrides. Standard weekday hours are not pre-filled. Pre-filled fields turn gold.

## Payroll rules — do not change without confirmation

**Chiltern Saturday payroll:** rostered Saturday → `sat` (1.25×); Saturday-on-RD → `rdw` bucket — staff use the RDW field, not the Saturday field. Confirmed by Gareth May 2026. Tests assert this.

**Chiltern Sunday-on-BH: Sunday wins (1.5×)** — `dow === 0` check is before `isBH` in the suggestion engine. Confirmed by Gareth May 2026.

**Boxing Day (26 Dec) is always 3× — even on a weekend.** The 3× rate attaches to the literal 26 December, whatever weekday it falls on; it is *not* moved to the substitute bank holiday. In the suggestion engine the `isBoxing` (26 Dec) check runs **before** both the Sunday (`dow === 0` → 1.5×) and Saturday (`dow === 6` → 1.25×) branches, so a worked 26 Dec always lands in the `box` bucket. The substitute bank holiday (e.g. Mon 28 Dec 2026) is a normal BH → `Bank Holiday Rostered 1.25`, not Boxing Day. Confirmed by Gareth Jul 2026. Tests assert both the Saturday (2026-12-26) and Sunday (2027-12-26) cases in `paycalc-roster-suggestions.test.mjs`.

**BH + `rdw` override is additive, not replacement** — `rdw` override on a worked BH day adds hours to `bhOt`; base hours stay in `bh`. Do not change to "override replaces base" without specific confirmation.

**Absence is FULL PAY and pays as the day underneath (owner, Jul 2026).** A `sick` override (incl. the roster codes **HA** = hospital appointment and **OD** = paid absence / long-term sick marking, both normalised to `SICK` at upload) resolves to the BASE shift in the suggestion engine: a rostered Saturday/BH keeps its premium at base hours; a weekday contributes nothing extra (basic pay covers it); a base REST day contributes NOTHING — the overpay guard for blanket Mon–Fri "OD" weeks marked on long-term sick members (the upload also normalises absence-on-rest-day to RD so it is never even written, and a re-upload REMOVE_IMPORTs stale ones). Absence can never land on a Sunday (existing block). **AL is deliberately NOT full-pay-resolved** — it still suppresses the day; leave pay is payroll's own mechanism. Tests assert all of this in `paycalc-roster-suggestions.test.mjs`.

**Training / Induction / Assessment / Team Day pays as the day underneath (OTHER_PLAN.md, confirmed by Gareth Jul 2026).** A `training` override is the ONLY override that falls back to the base instead of replacing it — resolved solely via `resolveOtherPay` in `override-utils.js` (never inline the mapping): weekday → contracted basic (nothing suggested); rostered Sat/BH/Boxing → that day's premium bucket at base hours; actual times on a rostered day → base-cap + excess→Overtime (BH over-run → `bhOt`, matching "Bank Holiday Overtime 1.25"); **`TRG RDW` (training rest-day) → RDW bucket, 8h default** (`OTHER_RDW_DEFAULT_MINS`) that the member adjusts — an RDW day is all-RDW, never split into overtime — and the minutes ROUTE BY DAY exactly like a plain rdw override: **Boxing Day → `box` (3×), a bank holiday → `bhOt`, anything else → `rdw`**; a rest-day base without the RDW flag still resolves to rdw (belt-and-braces — as-base would pay £0). A member is **never paid less than their rostered shift** even if training runs short. **Sundays and Boxing Day (26 Dec) can never be training days** (confirmed by Gareth Jul 2026) — so the `Boxing Day → box (3×)` routing noted above is a defensive fallback for a case that does not occur in practice, not a real path. Tests assert all of this in `paycalc-roster-suggestions.test.mjs`.

**Back-pay lump sum — always backdated to 1 April, paid-in month EXCLUDED (confirmed by Gareth Jul 2026).** `paycalc-backpay.js`: (1) **The award is always backdated to the April period** of the award tax year — Chiltern's pay anniversary. There is **no "backdated from" selector** (removed Jul 2026 — it always resolved to 1 April, so the choice was noise); `_backdatedFromPNum()` computes it internally as `48 + awardTy.first` and is the single source for both the accrual window's lower bound and the award tax year. Do not re-add a user-facing "backdated from" field.

**Back-pay is per-tax-year — one award per year, each with its own old→new rates (v15.94).** A pay rise happens once a year, backdated to 1 April, and is usually PAID mid-year as a lump when agreed (2025/26 landed on the 24 Oct 2025 payslip — same date as `londonAllowFrom`). The back-pay card computes the award for **whichever tax year's period is selected** in the main calculator (historic OR pending). The old/new rates come from `AWARD_RATES` in `paycalc-calc.js` (per grade/year, payslip-confirmed — CEA 2024/25 = £20.06, 2025/26 = £20.74), **not** the mutable `GRADES` default — so confirming a later award can never corrupt an earlier award's "old" rate. `prefillBackPay` fills OLD = `award.pre` (prior-year rate); for a **settled** year it also fills NEW = `award.rate`; for an **unconfirmed** year it leaves NEW to the `PENDING_AWARD_PCT` estimate. `#bpAwardScope` names the year on the card. A grade/year with no recorded `pre` (e.g. CES 2024/25) leaves the OLD box blank for manual entry — never guessed. This change is **scoped to the back-pay card**; the main calculator's per-year rate still comes from `GRADES` + the localStorage per-year override (it does NOT yet model the mid-year rate step, so a historic pre-24-Oct-2025 period still estimates at the full-year £20.74). (2) The **"which payslip carries this lump sum" (paid-in) defaults to the NEXT PAYDAY** = the current period (`currentPeriodNum()`) — the lump usually lands on the next payslip. (3) The **accrual excludes the paid-in period itself**: `_capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, currentPeriodNum())` — in the month the lump is paid you're already on the NEW rate, so that month is current pay, not back pay. (4) For an **unconfirmed** award year (`ty.rateUnconfirmed`) the **"Pay rise %" pre-fills `PENDING_AWARD_PCT`** (the currently offered award — 3.6% as of Jul 2026, awaiting RMT; update/remove when agreed) and the coordinator's `_applyBpRisePct()` derives the New rate/London — so the card opens with an editable **estimate** (the `#bpEstimateNote` banner makes the estimate framing explicit). `calcBackPay` is DOM-driven (not unit-tested) — verify changes with a rendered screenshot.

## Layout decisions

**`paycalc.html` desktop grid on `<main>`, not `.app`** — CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width.

**Sticky take-home bar (`#stickyTotal`)** — fixed bar on mobile (hidden ≥1024px). `IntersectionObserver` shows it when `.result-card` scrolls off. `body.sticky-active` adds bottom padding.

## State management

**`_clearState` object** — groups all state for the two-tap destructive clear action so it resets atomically. Includes `countdownTimer` for live countdown in button label.

**`CONDITIONAL_ROWS`** — data-driven array: condition → row IDs → field IDs. `updateBhRows(p)` iterates it. Adding future conditional rows means one array entry, not new show/hide logic.

**Per-member localStorage namespacing (v14.11)** — all per-member paycalc keys are prefixed with a member segment (`myb_pc_<slug>_…`) so two staff sharing a browser cannot read each other's pay data. `pcPrefix()` in `paycalc-migrations.js` is the single source of the prefix; `SK` and every key builder derive from it. `setPaycalcNamespace()` is invoked once from `runMigrations` (before `loadSettings`) to activate the member's namespace. Pre-existing shared/legacy data is **not** silently claimed — `hasPendingLegacyMigration()` detects it and `paycalc-lightboxes.js` prompts the member (mine → move / fresh → discard / ✕ → decide later); `resolveLegacyMigration()` applies the choice and sets the `myb_pc_ns_migrated` guard (v14.25). Device-level flags (migration guards, "seen notice/welcome", `myb_pc_ns_migrated`) stay unnamespaced — see `DEVICE_KEYS`. Never build a paycalc key without `pcPrefix()`/`SK`.

## Payslip line names — match these EXACTLY (source of truth)

**Principle:** the pay calculator is only useful if staff can find each figure on their actual
Chiltern payslip. So every "Shows as … on your payslip" pointer, field label, and notice MUST use
the payslip's own wording verbatim — never a paraphrase. The authoritative source is the real
payslip; the figures used by the regression tests live in `test-fixtures/miller-actuals.js`
(`gross` = the payslip's **"Taxable Pay"** line). When the calculator gains a new pay item, find its
exact payslip line name first and quote it.

| In-app item | Exact payslip line name | Rate |
|-------------|-------------------------|------|
| Pension contribution | `Smart RPS CR Scheme` | — |
| Year-to-date pay figure (for accurate tax) | `Taxable Pay` (in the **Year to Date** box) | — |
| Year-to-date tax figure | `Tax Paid` (in the **Year to Date** box) | — |
| London Allowance | `London Allowance` | fixed |
| Saturday (rostered) | `Ord Basic Pay @1.25` | 1.25× |
| Bank Holiday worked (rostered) | `Bank Holiday Rostered 1.25` | 1.25× |
| Bank Holiday overtime | `Bank Holiday Overtime 1.25` | 1.25× |
| Overtime | `Overtime 1.25` | 1.25× |
| Rest Day Worked | `RDW 1.25` | 1.25× |
| Rest Day Worked — Sunday | `RDW Sun 1.5` | 1.5× |
| Boxing Day | `Bank Holiday Overtime 3.0` | 3.0× |
| Peer training | shows as **extra basic pay** (no distinct line) | basic |

**Year to Date:** always spell it out as "Year to Date" (never bare "YTD") and call the two figures
exactly `Taxable Pay` / `Tax Paid` — NOT "Gross Pay" (the YTD figure is taxable pay, post-pension,
not gross). Don't invent friendlier names for these — the whole point is they match the payslip box.
