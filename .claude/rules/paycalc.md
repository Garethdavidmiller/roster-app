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

**BH + `rdw` override is additive, not replacement** — `rdw` override on a worked BH day adds hours to `bhOt`; base hours stay in `bh`. Do not change to "override replaces base" without specific confirmation.

## Layout decisions

**`paycalc.html` desktop grid on `<main>`, not `.app`** — CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width.

**Sticky take-home bar (`#stickyTotal`)** — fixed bar on mobile (hidden ≥1024px). `IntersectionObserver` shows it when `.result-card` scrolls off. `body.sticky-active` adds bottom padding.

## State management

**`_clearState` object** — groups all state for the two-tap destructive clear action so it resets atomically. Includes `countdownTimer` for live countdown in button label.

**`CONDITIONAL_ROWS`** — data-driven array: condition → row IDs → field IDs. `updateBhRows(p)` iterates it. Adding future conditional rows means one array entry, not new show/hide logic.

**Per-member localStorage namespacing (v14.11)** — all per-member paycalc keys are prefixed with a member segment (`myb_pc_<slug>_…`) so two staff sharing a browser cannot read each other's pay data. `pcPrefix()` in `paycalc-migrations.js` is the single source of the prefix; `SK` and every key builder derive from it. `setPaycalcNamespace()` is invoked once from `runMigrations` (before `loadSettings`) to activate the member's namespace. Pre-existing shared/legacy data is **not** silently claimed — `hasPendingLegacyMigration()` detects it and `paycalc-lightboxes.js` prompts the member (mine → move / fresh → discard / ✕ → decide later); `resolveLegacyMigration()` applies the choice and sets the `myb_pc_ns_migrated` guard (v14.25). Device-level flags (migration guards, "seen notice/welcome", `myb_pc_ns_migrated`) stay unnamespaced — see `DEVICE_KEYS`. Never build a paycalc key without `pcPrefix()`/`SK`.
