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

**Training / Induction / Assessment pays as the day underneath (TRAINING_PLAN.md, confirmed by Gareth Jul 2026).** A `training` override is the ONLY override that falls back to the base instead of replacing it — resolved solely via `resolveTrainingPay` in `override-utils.js` (never inline the mapping): weekday → contracted basic (nothing suggested); rostered Sat/BH/Boxing → that day's premium bucket at base hours; actual times on a rostered day → base-cap + excess→Overtime (BH over-run → `bhOt`, matching "Bank Holiday Overtime 1.25"); **`TRG RDW` (training rest-day) → RDW bucket, 8h default** (`TRG_RDW_DEFAULT_MINS`) that the member adjusts — an RDW day is all-RDW, never split into overtime; a rest-day base without the RDW flag still resolves to rdw (belt-and-braces — as-base would pay £0). A member is **never paid less than their rostered shift** even if training runs short. Sundays can never be training days. Tests assert all of this in `paycalc-roster-suggestions.test.mjs`.

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
