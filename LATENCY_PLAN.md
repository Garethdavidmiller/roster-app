# LATENCY_PLAN.md — sign-in and Calendar start

*Created August 2026 (at v21.30), external review. Not version-stamped; not a runtime asset.*

**Phase 1 has shipped. Phases 2 and 3 are deliberately NOT started, and the reason is the point of
this file:** the instrumentation that decides between them only began collecting at v21.30. Starting
either one now would be choosing on intuition, which is the thing the measurement was built to stop.

Design detail lives beside the code, as ever — `perf-reporter.js` and `perf-stats.js` for what is
measured, `AI_MAP.md` for the ladder's exports, `CALENDAR_DATA.md` for the invariants any change
here must not break. This file holds only the SEQUENCE and the DECISION RULE.

---

## What was already good, and why the obvious answers were refused

The review's own framing, kept because it stops the next reader re-proposing them: service-worker
SWR caching, the SDK cache, `modulepreload` on the two heaviest pages, 60-day sessions, in-place
sign-in, `primeAuth`, the Firestore local cache and the cache-before-server Calendar read were all
already in place. The remaining gains need the critical path to CHANGE, not to be tuned.

Two things were considered and refused outright:

| Refused | Why |
|---|---|
| **Render the base roster instantly, correct it when Firestore answers** | Override-unknown is not override-absent. It would look fast and reintroduce the exact defect `calendar-data-state.js` exists to prevent. **Latency must not buy a false roster.** |
| **Extend the session past 60 days** | It reduces how OFTEN latency is felt without improving it, and lengthens the life of a stale local session. Optimise the real path instead. |

---

## Phase 1 — SHIPPED (v21.29–v21.30)

| Change | Outcome |
|---|---|
| One shared Firebase auth bootstrap | Three `onAuthStateChanged` subscriptions with three bounds became one. The Calendar's worst-case access decision went from **two stacked ceilings (6.5s + 6s) to a single 6.5s budget** |
| `markPageReady` means a real roster grid | It was timing the withheld "Checking this month…" state — and doing so most often on the SLOWEST loads, so the figure was biased in the flattering direction and unreadable in either |
| The local cache wins the first paint | A bounded 90ms for phase 1's IndexedDB read, so a returning device stops painting a spinner over data milliseconds away |
| The start ladder | Four cumulative milestones — Recognised · Unlocked · Shifts shown · Confirmed — rendered as "How far the start gets" |

**The ladder is the deliverable that matters here**, because it is what makes the rest of this plan
decidable rather than arguable.

---

## The decision rule — read this before starting phase 2 or 3

The four milestones nest, so the biggest gap between adjacent rows names the phase to do next.
Compare rows; do not do arithmetic.

| The gap is between | What is slow | Do |
|---|---|---|
| page start → **Recognised** | restoring the saved sign-in | **Phase 3** (split Auth from Firestore) |
| Recognised → **Unlocked** | the access decision itself | re-read `calendar-access.js`; phase 3 helps only indirectly |
| Unlocked → **Shifts shown** | reaching a roster at all | **Phase 2** (fetch less, sooner) |
| Shifts shown → **Confirmed** | the authoritative Firestore read | **Phase 2**, and its member/month narrowing especially |

**Wait for a full month before reading it.** The card's own `THIN_SAMPLE` rule governs these rows;
a week of data on a 50-person app can read 100% and mean nothing.

**One honest caveat:** the ladder measures the Calendar only, and only loads that reach each rung. A
member who never gets past the gate contributes no `Confirmed`, so that row's population is smaller
than the ones above it by construction — the same property the card already states about `ready`.

---

## Phase 2 — the Calendar data path

**Trigger:** the ladder shows the gap at Unlocked → Shifts shown, or Shifts shown → Confirmed.

Today the first authoritative read asks Firestore for **every member's overrides across three
months** before the displayed month can be called current. The ordinary member opening the Calendar
wants **one person's current month**. Those are very different workloads, and the composite index
`memberName` + `date` already exists.

1. Fetch the **displayed month** first, rather than previous/current/next together.
2. Background-prefetch the adjacent months once the first grid is up.
3. Then the stronger form: **selected member + displayed month**, on the existing index.
4. Load whole-team data only when Team View needs it.

**The constraint this must not break:** the first grid still may not be presented as current until
its own overrides are authoritative. Narrowing WHAT is fetched is legitimate; narrowing what is
KNOWN before rendering is not. `CALENDAR_DATA.md` invariants 1, 2 and 6.

**And Team View is the trap.** Its fetcher was unified into the shared month machinery at v18.76
precisely because a second authoritative reconciler racing the first evicted overrides the initial
fetch had just loaded. Any per-member narrowing has to keep that single-reconciler property.

---

## Phase 3 — split Firebase Auth from Firestore

**Trigger:** the ladder shows the gap before Recognised, i.e. cold sign-in and cold Calendar start
are dominated by getting an identity.

`firebase-client.js` statically imports app, auth **and** Firestore, so somebody who only needs to
sign in still pulls the database SDK into the module graph. Authentication does not require
Firestore.

- `firebase-app` (init) · `firebase-auth-client` (auth, persistence, `authBootstrap`) ·
  `firebase-firestore-client` (db and query helpers).
- `session.js` then depends on auth only.
- Prove it on ONE protected page before rolling it out. Most staff authenticate every 60 days, so
  the Calendar matters more than the login journey — sequence accordingly.

**Cost side, measured and recorded so the next person is not guessing:** the Calendar's critical
path is ~782 KB of unminified JS across 40 modules plus ~214 KB of render-blocking CSS, and under 6×
CPU throttling reaching `myb-sdk-ready` takes 682 ms. See CLAUDE.md → *When a build step earns its
keep*, which this phase does **not** by itself trigger.

---

## Phase 4 — only if the measurement still says so

Reducing the Calendar's critical `modulepreload` graph, and the bundler question.

**The bundler already has a home and a trigger — `ROADMAP.md` → Build tooling.** It is not restated
here. The one thing to add: the app does not have a general too-much-JavaScript problem (execution
measured at ~18ms), so the case only becomes compelling if the ladder shows the remaining tail in
the fetch/parse phase after phases 2 and 3 have landed.

---

## What would make this file wrong

If the ladder's rows come back uniformly quick, phases 2 and 3 are not worth their risk and this
plan should be closed rather than worked through out of momentum. Record that outcome here if it
happens — a plan that was measured and dropped is more useful to the next reader than one that
quietly stopped.
