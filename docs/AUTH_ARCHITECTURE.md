# AUTH_ARCHITECTURE.md — moved

*Not version-stamped; not a runtime asset. **A pointer, not a document.** Not to be confused with
`ARCHITECTURE.md`, the documents index.*

**Folded into `AUTH_AND_SESSIONS.md` on 24 Nov 2026.** This file is kept because code comments cite it
by **Track 1**, by **Phase number** and by **PAYSLIP_ACTUALS**; each anchor below says where that
material lives now. Nothing here is authoritative.

| Content | Now lives in |
|---|---|
| The live architecture — the two pure layers, the store, the degraded-state rules, "reads hydrate optimistically; writes authorise strictly", the guardrails | `AUTH_AND_SESSIONS.md` → **Architecture** |
| Which page admits whom | `PAGE_POLICIES` in `auth-policy.js` — read the map, never a copy (the page table that stood here went stale) |
| What each phase built, the Phase 4 and Phase 9 appendices, the track ranking | `ROADMAP_HISTORY.md` → "Track 1 — the auth consolidation phases (moved 24 Nov 2026)" |
| The real-payslip fixture and the device-local actuals | `.claude/rules/paycalc.md` → Example payslips · `KNOWN_LIMITATIONS.md` → "Real payslip figures stay in git HISTORY" |

## Track 1

The identity state machine (`auth-state-core.js`) and the page-auth policy map (`auth-policy.js`).
Complete and behaviour-preserving; it landed before B3. Architecture: `AUTH_AND_SESSIONS.md` →
Architecture. Its phases are below.

## The phases

One line each; the record is `ROADMAP_HISTORY.md` → "Track 1 — the auth consolidation phases".

- **Phase 0** — the characterisation net pinned before the refactor.
- **Phase 1** — `auth-state-core.js`, the pure reducer (Layer 1).
- **Phase 2 / 2.5** — `auth-state.js`, the store fed by `session.js`; `sessionReady` left untouched.
- **Phase 3** — `auth-policy.js`, `PAGE_POLICIES` and `requirePageAuth` (Layer 2).
- **Phase 4a / 4a.2 / 4b** — Operations consumes the store and policy; every protected page's body
  becomes an exported `init()` called by a two-line `*-boot.js`; admin reads self-heal a stale claim.
- **Phase 5 · 6 · 7** — Links · Admin · Settings and the Pay Calculator (Pay stays **soft**, its
  no-session gate outside the policy).
- **Phase 8** — B3, handed to `SECURITY_RELEASE_PLAN.md`.
- **Phase 9** — in-place sign-in: no reload after a confirmed sign-in.

## Appendix: Phase 4 detailed scope

`ROADMAP_HISTORY.md` → "Track 1 — the auth consolidation phases" → Phase 4.

## Appendix: Phase 9

`ROADMAP_HISTORY.md` → "Track 1 — the auth consolidation phases" → Phase 9. The mechanism's safety
net is live code: an in-place `onSuccess` reloads if `init()`/`initAuthorised()` throws or the session
save failed (`e2e/auth.spec.js`, the no-reload tests). The "Phase 10" note (scoped, deliberately not
built) moved with it.

## PAYSLIP_ACTUALS

**The real payslip figures are never served and never in the repository**: the gitignored
`test-fixtures/payslip-actuals.local.js`. The rules and what the skip costs are
`.claude/rules/paycalc.md` → Example payslips; the history left in git is `KNOWN_LIMITATIONS.md` →
"Real payslip figures stay in git HISTORY"; the options that were declined are in `ROADMAP_HISTORY.md`
→ "Track 1 — the auth consolidation phases" → PAYSLIP_ACTUALS.
