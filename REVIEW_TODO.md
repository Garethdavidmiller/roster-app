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

- [ ] Firebase **App Check** (integrity control for analytics + override writes).
- [ ] Re-introduce **per-member Firestore write isolation** (documented re-introduction checklist).
- [ ] **Workload Identity Federation** to retire the long-lived service-account JSON.
- [ ] Clear the **9 transitive moderate Functions advisories** (needs `firebase-admin`/`-functions` upgrade).
- [ ] Password-model upgrade (paired with Power-Automate work).

## ✔️ Verified FALSE during review (no action)

- **M9 — DOMPurify `style` → CSS injection.** Refuted: `calendar-huddle-viewer.js:69` allows
  only `colspan`/`rowspan`; `style` is deliberately excluded (v12.83 revert documented in-code).
