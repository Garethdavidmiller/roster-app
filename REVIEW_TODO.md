# Review follow-up TODO (temporary — delete when all items done)

Source: full line-by-line review of v14.36 (two independent passes + direct source verification).
Tracking branch: `claude/review-claude-md-mKJbK`. Remove this file once every item below is done.

## ✅ Quick wins — DONE this pass (target v14.37)

- [x] **H1 — Mammoth CDN failure aborts manual DOCX upload.** `huddle.js` — on the
  converter-*load* failure, fall through with `htmlContent = null` (upload proceeds; the
  viewer shows its "Open Huddle" download button, same as PDFs) instead of aborting the
  upload. A genuinely corrupt `.docx` (conversion error, not load error) still aborts.
- [x] **M1 — Override `note` stored but never shown.** `admin-overrides.js` Saved Changes
  table surfaces the note inline under the value cell (no new column — keeps the 375px
  mobile layout intact). CSS `.override-note` added to `admin.css`.
- [x] **Parity test — `normaliseSurname` ↔ `nameToPassword`.** New `surname-parity.test.mjs`:
  behavioural assertions on the real (CommonJS) `nameToPassword` across teamMembers + edge
  cases, plus a source-equivalence assertion so editing the regex in one file fails the test.

## ✅ Easy / contained — DONE (v14.37 follow-up pass)

- [x] **L1 — `storage.rules` read comment** clarified: the `request.auth != null` read rule
  gates only direct SDK reads; staff open the tokenised bearer download URL (which bypasses
  Storage rules). Reworded all three read comments (huddles/circulars/newsletters). Comment-only.
- [x] **L2 unit test** — `paycalc-migrations.test.mjs`: a hidden (leaver) member's namespaced
  key is recognised as owned, not legacy; genuinely unnamespaced data still triggers the prompt.
- [x] **Non-blocking `functions/` npm-audit CI** — already present: `.github/workflows/
  functions-audit.yml` (scheduled weekly + manual, pinned actions, read-only). Uses
  `--audit-level=high` so it stays green on the current unfixable moderates and only alerts
  on high/critical. No change needed.

## ✅ Accessibility + desktop-test polish — DONE (v14.38)

- [x] **Emoji text equivalents** — `getShiftBadge()` (roster-data.js) now marks every badge
  emoji `aria-hidden="true"` (matching the sibling early/late badges in calendar-renderer.js);
  the text label (AL/Absent/Rest/…) carries the meaning. Also applied to the index.html Team
  View colour-key legend. Reduces screen-reader noise in the admin week grid + roster-review
  table, which render the badge without an overriding cell `aria-label`. Test mirror updated.
- [x] **Guide chip `aria-current`** — already implemented (railcard-guide.js sets/clears
  `aria-current` on the active chip; it's the only chip-bar). No change needed.
- [x] **Team View cell names** — already accessible (each cell has an `aria-label`). No change.
- [x] **Desktop-geometry e2e** — extended smoke.spec.js: calendar @1024/1280/1440 + 1024×720
  short height; team view (internal scroll, no page overflow); signed-in admin @1024/1280/1440;
  paycalc @1280×720 short height. 48 e2e tests now pass (was 30).

## ⏳ Time-boxed maintenance (deadlines, not bugs)

- [ ] **H3 — 2026/27 pay rates.** Currently `rateUnconfirmed` placeholders (UI warns).
  When the award lands: update `GRADES.cea/ces.rate` + London Allowance in `paycalc-calc.js`,
  clear `rateUnconfirmed`.
- [ ] **M2 — Paycalc period selector ends ~P62 (≈ March 2027).** Extend `TAX_YEARS` +
  `FIRST_OFFSET`/`LAST_OFFSET` + thresholds before April 2027 (documented rollover task).
- [ ] **Doc re-stamp sweep** falls due at v14.40 (all 5 docs currently v14.30 — within policy).
- [ ] **M7 — Override collection scale.** Define an archival strategy before ~5000 docs.
- [ ] **MAX_YEAR 2030 → 2032** before end of 2028 (update lunar/BH data first).

## ⏳ Dedicated security release (when password / Power-Automate work resumes)

**Now scoped + phased in `SECURITY_RELEASE_PLAN.md`** (created v14.38) — dependency graph,
permissive→strict token-refresh migration (avoids the v10.94 outage), the "never enforce App
Check during the isolation rollout" constraint, per-phase risk/rollback, and the owner-decision
checklist. The items below are the scope; that file is the order — start there.

- [x] **B0 (observability)** `ensureFirebaseSession` exposes named-vs-anonymous identity (v14.39, tested, no behaviour change). Enforce half folded into B1.
- [~] **B1** named-session separation — code DONE behind the default-OFF `ENFORCE_NAMED_SESSION`
  switch (v14.40–v14.41). Enable after the owner provisioning audit + a flag-ON e2e test.
- [ ] **B2–B4** per-member write isolation + server-owned lists.
- [ ] **C2–C5** password-model upgrade (verify email → reset → change → retire surname).
- [ ] **D1–D2** Firebase **App Check** (monitor-first, then enforce).
- [ ] **A2** **Workload Identity Federation** to retire the long-lived service-account JSON.
- [ ] **A1** Clear the **9 transitive moderate Functions advisories** (firebase-admin v14, upstream-blocked).

## ✔️ Verified FALSE during review (no action)

- **M9 — DOMPurify `style` → CSS injection.** Refuted: `calendar-huddle-viewer.js:69` allows
  only `colspan`/`rowspan`; `style` is deliberately excluded (v12.83 revert documented in-code).
